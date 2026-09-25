/**
 * The Color page's clip list: the timeline's picture clips in the order a colourist walks them,
 * numbered, with whether each already carries a look. Pure, so the order and the "adjusted" mark
 * are tested without React.
 */

import { findAsset, type Asset, type Item, type Project, type Timeline } from '@shared/project'
import { isGradeableKind, resolveGrade } from '@shared/grade'
import { attributePatch, type PasteAttribute } from '@shared/clipboard'
import { adjustmentFilter, NO_FILTER } from '@/engine/looks'

export interface ColorClip {
  item: Item
  asset: Asset | undefined
  /** 1-based, in timeline order: what the strip prints and what "clip 3" means. */
  number: number
  trackName: string
  /** Something on this clip changes its colour: a grade that is not identity, or adjustments. */
  adjusted: boolean
}

/** Whether a clip's look changes its picture — the strip's orange dot, Resolve's "adjusted" mark. */
export function hasLook(item: Pick<Item, 'grade' | 'adjustments'>): boolean {
  return resolveGrade(item.grade) !== null || adjustmentFilter(item.adjustments) !== NO_FILTER
}

/**
 * Every clip on a video track that a grade can draw on (`isGradeableKind`: not text, which draws
 * its own glyphs, and not sound). In time order; clips that start together are listed top track
 * first, since the top one is what the viewer shows.
 */
export function colorClips(project: Project, timeline: Timeline): ColorClip[] {
  const order = new Map(timeline.tracks.map((track, index) => [track.id, index]))
  const found: { item: Item; asset: Asset | undefined; trackName: string }[] = []
  for (const track of timeline.tracks) {
    if (track.kind !== 'video') continue
    for (const item of track.items) {
      const asset = findAsset(project, item.assetId)
      if (!isGradeableKind(asset?.kind)) continue
      found.push({ item, asset, trackName: track.name })
    }
  }
  found.sort(
    (a, b) => a.item.from - b.item.from || (order.get(b.item.trackId) ?? 0) - (order.get(a.item.trackId) ?? 0)
  )
  return found.map((entry, index) => ({ ...entry, number: index + 1, adjusted: hasLook(entry.item) }))
}

const GRADE_ATTRIBUTES: ReadonlySet<PasteAttribute> = new Set<PasteAttribute>(['grade', 'adjustments'])

/**
 * The patch that gives `target` a copied look: Paste Attributes' own patch for "Colour grade"
 * and "Adjustments" (`attributePatch`), so a copied "no grade" removes the target's grade exactly
 * as it does there — with the target's blend mode kept, since a grade is not a composite mode.
 */
export function gradePatch(source: Pick<Item, 'grade' | 'adjustments'>, target: Item): Partial<Item> {
  const from: Item = { ...target, grade: source.grade, adjustments: source.adjustments, blendMode: target.blendMode }
  const { blendMode: _kept, ...patch } = attributePatch(from, target, GRADE_ATTRIBUTES)
  return patch
}
