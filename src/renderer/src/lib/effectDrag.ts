/**
 * Dragging a video effect from the Effects Library onto a clip on the timeline.
 *
 * The payload names the effect; the lane that receives it finds the clip under the pointer
 * (`effectDropTarget`) and adds the effect to it — the same edit a click in the library makes on
 * the selection. Pure, like `transitionDrag.ts` beside it.
 */

import { findAsset, itemEnd, type Frames, type Item, type Project, type Timeline } from '@shared/project'
import { effectSpec, takesEffects } from '@shared/effects/index'

export const EFFECT_DRAG_TYPE = 'application/x-bay-effect'

export interface EffectDrag {
  kind: string
  label: string
}

export function encodeEffectDrag(kind: string): string {
  return JSON.stringify({ kind })
}

/** The effect a payload names, or null for anything that is not a catalog effect. */
export function decodeEffectDrag(raw: string): EffectDrag | null {
  try {
    const value = JSON.parse(raw) as { kind?: unknown }
    const spec = typeof value.kind === 'string' ? effectSpec(value.kind) : undefined
    return spec ? { kind: spec.kind, label: spec.label } : null
  } catch {
    return null
  }
}

export type EffectDropTarget =
  | { ok: true; item: Item }
  /** A clip is under the pointer and cannot take an effect; `reason` is the sentence to show. */
  | { ok: false; reason: string }

/**
 * The clip on `trackId` a drop at `frame` lands on, or null when the pointer is over a gap —
 * a drop on empty lane is not a guess at the nearest clip.
 */
export function effectDropTarget(project: Project, timeline: Timeline, trackId: string, frame: Frames): EffectDropTarget | null {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId)
  if (!track) return null
  const item = track.items.find((candidate) => candidate.from <= frame && frame < itemEnd(candidate))
  if (!item) return null
  const asset = findAsset(project, item.assetId)
  if (track.kind !== 'video' || !takesEffects(asset?.kind)) {
    return {
      ok: false,
      reason:
        asset?.kind === 'text'
          ? 'A title has no picture for a video effect: its look is in the inspector’s Title tab.'
          : 'Video effects go on clips with a picture: video, images and compositions.'
    }
  }
  if (track.locked) return { ok: false, reason: `${track.name} is locked. Unlock it to add an effect to its clips.` }
  return { ok: true, item }
}
