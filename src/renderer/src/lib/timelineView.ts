/**
 * Per-viewer timeline state that is not the project and not the editor store's business: how
 * tall each track is drawn, and which gap is selected.
 *
 * A gap is not an item, so it has no place in `selection` (item ids) — and a second kind of
 * selection in the editor store would ask every consumer of `selection` whether it meant a gap.
 * It lives here, and clears whenever a clip is selected (`Timeline` subscribes), so the two
 * never coexist. Delete and ⇧Delete close a selected gap before they act on clips
 * (`lib/commands/clip.ts`).
 */

import { create } from 'zustand'
import { useEditor } from '@/store/editor'
import { remember, remembered } from '@/store/prefs'
import type { Gap, TrackSize } from './timelineLayout'

/**
 * Stored as JSON under this key: `{ [trackId]: size }`. Read back by later builds, so it is a
 * compatibility surface (CLAUDE.md); a missing or garbled value is every track at medium.
 */
const TRACK_SIZES_KEY = 'bay.trackSizes'

function readSizes(): Record<string, TrackSize> {
  try {
    const parsed: unknown = JSON.parse(remembered(TRACK_SIZES_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, TrackSize> = {}
    for (const [id, size] of Object.entries(parsed)) {
      if (size === 'small' || size === 'medium' || size === 'large') out[id] = size
    }
    return out
  } catch {
    return {}
  }
}

interface TimelineViewState {
  trackSizes: Record<string, TrackSize>
  setTrackSize(trackId: string, size: TrackSize): void
  selectedGap: Gap | null
  selectGap(gap: Gap | null): void
}

export const useTimelineView = create<TimelineViewState>((set, get) => ({
  trackSizes: readSizes(),
  setTrackSize(trackId, size) {
    const next = { ...get().trackSizes }
    // Medium is the default, stored as absence so the map only holds what someone changed.
    if (size === 'medium') delete next[trackId]
    else next[trackId] = size
    remember(TRACK_SIZES_KEY, Object.keys(next).length > 0 ? JSON.stringify(next) : null)
    set({ trackSizes: next })
  },
  selectedGap: null,
  selectGap(gap) {
    if (gap) useEditor.getState().clearSelection()
    set({ selectedGap: gap })
  }
}))

/**
 * Closes a gap: the clips after it on its track move left by its length (and their linked
 * clips with them) — `closeGapAt`, the same action the Close Gap command runs. A refusal names
 * its blocker, so it is shown as it comes.
 */
export function closeGap(gap: Gap): boolean {
  const store = useEditor.getState()
  const result = store.closeGapAt(gap.trackId, gap.from)
  if ('error' in result) {
    store.notify(result.error, 'error')
    return false
  }
  return true
}

/** Delete / ⇧Delete with a gap selected: close it and report that the key was used. */
export function closeSelectedGap(): boolean {
  const gap = useTimelineView.getState().selectedGap
  if (!gap) return false
  useTimelineView.getState().selectGap(null)
  closeGap(gap)
  return true
}
