/**
 * Adjustment layers: a clip with no picture of its own, on a video track, whose colour grade,
 * adjustments and masks apply to **everything drawn beneath it** for as long as it lasts.
 *
 * It is an ordinary item — it moves, trims, splits, fades, takes opacity keys and sits in a track's
 * order like any clip — whose asset is `kind: 'adjustment'`. One such asset serves every layer in
 * a project (assets are the "what", items the "where and when"), so ten layers are ten items and
 * one asset, and each item carries its own `grade`, `adjustments` and `masks`.
 *
 * What the compositor does with one (`engine/adjustmentLayer.ts`, called from `#paintItem`):
 * copies the frame so far, and draws that copy back over itself through the item's look — the
 * same `#drawSource` every clip goes through, so the grade pass, the CSS adjustments, shape masks
 * and anything a later build adds to that function reach a layer with no code of their own. With
 * masks, only the masked part is replaced; at opacity 0.5 the adjusted picture is mixed half and
 * half with the original. Preview, `preview_frame` and export all draw frames through that one
 * function, so they cannot disagree.
 *
 * **It always covers the whole frame.** Its `layout` box is kept for the format's sake and not
 * read: position, size, rotation and crop on a layer would be controls for "which part", and that
 * is what its masks are for (they are fractions of the frame). Its blend mode is not read either.
 *
 * A layer that changes nothing — no grade, identity adjustments — is skipped, so it costs nothing;
 * a project with no layer never reaches any of this.
 */

import { defaultLayout, itemEnd, itemsOverlap, type Asset, type Item, type Project, type Timeline, type Track } from './project'

export const ADJUSTMENT_KIND = 'adjustment'
export const ADJUSTMENT_LAYER_NAME = 'Adjustment layer'

export function isAdjustmentAsset(asset: Pick<Asset, 'kind'> | undefined | null): boolean {
  return asset?.kind === ADJUSTMENT_KIND
}

/** The asset behind every adjustment layer: no file, no picture, no sound, no length of its own. */
export function adjustmentAsset(id: string, createdAt: number): Asset {
  return {
    id,
    kind: ADJUSTMENT_KIND,
    name: ADJUSTMENT_LAYER_NAME,
    path: null,
    durationUs: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: false,
    hasVideo: false,
    posterPath: null,
    waveformPath: null,
    createdAt
  }
}

export interface AdjustmentLayerSpec {
  /** First frame. */
  from: number
  durationInFrames: number
  /** A video track to put it on. Absent: the top video track if it is free there, else a new one above everything. */
  trackId?: string
}

export interface AdjustmentLayerOptions {
  makeId(prefix: string): string
  /** A new, empty video track, named by the caller. */
  makeVideoTrack(timeline: Timeline): Track
  now(): number
}

export type AdjustmentLayerResult =
  | {
      ok: true
      itemId: string
      trackId: string
      assetId: string
      /** Set when a track was made for it. */
      createdTrackId?: string
      /** How many clips are drawn under it at some point of its span — what it will change. */
      clipsBelow: number
      warnings: string[]
    }
  | { ok: false; error: string }

/**
 * Puts an adjustment layer on `timeline` (already a clone the caller may mutate — the store runs
 * this inside one `edit()`, so the asset and the item are one undo step).
 *
 * Refusals say what to do next: which track is locked or busy, and for how long.
 */
export function planAdjustmentLayer(project: Project, timeline: Timeline, spec: AdjustmentLayerSpec, options: AdjustmentLayerOptions): AdjustmentLayerResult {
  if (!Number.isFinite(spec.from) || spec.from < 0) return { ok: false, error: `from must be a frame number of 0 or more; got ${JSON.stringify(spec.from)}.` }
  if (!Number.isFinite(spec.durationInFrames) || spec.durationInFrames < 1) {
    return { ok: false, error: `durationInFrames must be at least 1 frame; got ${JSON.stringify(spec.durationInFrames)}.` }
  }
  const from = Math.round(spec.from)
  const durationInFrames = Math.round(spec.durationInFrames)
  const span = { from, durationInFrames } as Item
  const busy = (track: Track): Item | undefined => track.items.find((other) => itemsOverlap(other, span))

  let track: Track | undefined
  let createdTrackId: string | undefined
  if (spec.trackId !== undefined) {
    track = timeline.tracks.find((candidate) => candidate.id === spec.trackId)
    const videoTracks = timeline.tracks.filter((candidate) => candidate.kind === 'video').map((candidate) => `${candidate.id} (${candidate.name})`).join(', ')
    if (!track) return { ok: false, error: `No track ${spec.trackId} on this timeline. Its video tracks: ${videoTracks}. Leave trackId out to put the layer above everything.` }
    if (track.kind !== 'video') return { ok: false, error: `${track.name} is an audio track; an adjustment layer goes on a video track: ${videoTracks}. Leave trackId out to put it above everything.` }
    if (track.locked) return { ok: false, error: `${track.name} is locked. Unlock it, or leave trackId out to put the layer on a new track above everything.` }
    const clash = busy(track)
    if (clash) {
      return {
        ok: false,
        error:
          `${track.name} already has clip ${clash.id} over frames ${clash.from}–${itemEnd(clash)}, where the layer (frames ${from}–${from + durationInFrames}) would go. ` +
          `Leave trackId out to put the layer on a track above everything, or choose frames clear of that clip.`
      }
    }
  } else {
    // Above everything is the layer's natural place: it changes what is under it. The top video
    // track when it is free and unlocked there, otherwise a new one on top.
    const top = [...timeline.tracks].reverse().find((candidate) => candidate.kind === 'video')
    if (top && !top.locked && !busy(top)) track = top
    else {
      track = options.makeVideoTrack(timeline)
      timeline.tracks.push(track)
      createdTrackId = track.id
    }
  }

  let asset = project.assets.find((candidate) => isAdjustmentAsset(candidate) && !candidate.error)
  if (!asset) {
    asset = adjustmentAsset(options.makeId('ast'), options.now())
    project.assets.push(asset)
  }
  const item: Item = {
    id: options.makeId('itm'),
    assetId: asset.id,
    trackId: track.id,
    from,
    durationInFrames,
    sourceStartUs: 0,
    layout: defaultLayout(timeline),
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
  track.items.push(item)
  track.items.sort((a, b) => a.from - b.from)

  const index = timeline.tracks.indexOf(track)
  let clipsBelow = 0
  const warnings: string[] = []
  for (let i = 0; i < index; i += 1) {
    const below = timeline.tracks[i]!
    if (below.kind !== 'video' || below.hidden) continue
    clipsBelow += below.items.filter((other) => !other.disabled && itemsOverlap(other, span)).length
  }
  if (clipsBelow === 0) {
    warnings.push(
      `Nothing is drawn under the layer over frames ${from}–${from + durationInFrames}, so it will only change the background. ` +
        'An adjustment layer changes the tracks below its own; move it above the clips it should change, or over frames that have clips.'
    )
  }
  const above = timeline.tracks.slice(index + 1).filter((candidate) => candidate.kind === 'video' && candidate.items.some((other) => itemsOverlap(other, span)))
  if (above.length > 0) {
    warnings.push(`Clips on ${above.map((candidate) => candidate.name).join(', ')} are above the layer and are not changed by it.`)
  }
  return { ok: true, itemId: item.id, trackId: track.id, assetId: asset.id, ...(createdTrackId ? { createdTrackId } : {}), clipsBelow, warnings }
}

/** Layout and framing fields that an adjustment layer does not read, by the `edit_item` argument that sets each. */
export const ADJUSTMENT_UNREAD_ARGS = ['left', 'top', 'width', 'height', 'rotation', 'scale', 'crop', 'blendMode', 'speed', 'reverse', 'speedRamp', 'sourceStartSeconds', 'volume', 'pan'] as const
