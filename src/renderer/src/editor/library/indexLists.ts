/**
 * The Index tab's edit list, as data: every place a clip starts or ends, per track, in time order —
 * Resolve's Edit Index, cut down to what bay's model has. A start that meets another clip's end is
 * one row, a cut, and names the transition on it; a start after a gap and an end before one are
 * rows of their own. Pure, tested beside it.
 */

import { findAsset, itemEnd, type Frames, type Project, type Timeline, type TransitionKind } from '@shared/project'

export interface EditRow {
  /** Stable across renders while the same clips meet at the same frame. */
  key: string
  frame: Frames
  trackId: string
  trackName: string
  trackKind: 'video' | 'audio'
  kind: 'cut' | 'start' | 'end'
  /** The clip being left (a cut or an end). */
  from?: { itemId: string; name: string }
  /** The clip being entered (a cut or a start). */
  to?: { itemId: string; name: string }
  /** The transition stored on a cut. */
  transition?: TransitionKind
}

export function editRows(project: Project, timeline: Timeline): EditRow[] {
  const rows: EditRow[] = []
  const nameOf = (assetId: string): string => findAsset(project, assetId)?.name ?? 'Clip'
  const order = new Map(timeline.tracks.map((track, index) => [track.id, index]))
  for (const track of timeline.tracks) {
    const base = { trackId: track.id, trackName: track.name, trackKind: track.kind }
    const items = [...track.items].sort((a, b) => a.from - b.from)
    items.forEach((item, index) => {
      const previous = items[index - 1]
      const next = items[index + 1]
      const self = { itemId: item.id, name: nameOf(item.assetId) }
      if (!previous || itemEnd(previous) !== item.from) {
        rows.push({ ...base, key: `start:${item.id}`, frame: item.from, kind: 'start', to: self })
      }
      if (next && itemEnd(item) === next.from) {
        const transition = (timeline.transitions ?? []).find((t) => t.fromItemId === item.id && t.toItemId === next.id)
        rows.push({
          ...base,
          key: `cut:${item.id}:${next.id}`,
          frame: next.from,
          kind: 'cut',
          from: self,
          to: { itemId: next.id, name: nameOf(next.assetId) },
          ...(transition ? { transition: transition.kind } : {})
        })
      } else {
        rows.push({ ...base, key: `end:${item.id}`, frame: itemEnd(item), kind: 'end', from: self })
      }
    })
  }
  return rows.sort((a, b) => a.frame - b.frame || (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
}
