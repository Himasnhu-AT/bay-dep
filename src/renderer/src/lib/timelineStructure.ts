/**
 * What the Join and Move Track commands do, shared by the menu bar, the shortcuts, the track
 * header's menu and its drag — so each of those is one line and they cannot disagree.
 */

import { create } from 'zustand'
import { itemEnd, type Track, type TrackKind } from '@shared/project'
import { nextOnTrack } from '@shared/heal'
import { selectTimeline, useEditor } from '@/store/editor'

/**
 * Join through-edits: among the selected clips, or — with nothing selected — at every cut the
 * playhead is parked on. Says what happened either way; a real cut is refused with why.
 */
export function joinClips(): void {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  if (!timeline) return
  let ids: string[] = state.selection
  if (ids.length === 0) {
    ids = timeline.tracks
      .filter((track) => !track.locked)
      .flatMap((track) =>
        track.items
          .filter((item) => itemEnd(item) === state.playhead)
          .flatMap((item) => {
            const next = nextOnTrack(track, item)
            return next ? [item.id, next.id] : []
          })
      )
  }
  const result = state.joinItems(ids)
  if ('error' in result) {
    state.notify(result.error, 'error')
    return
  }
  const cuts = result.joined.length
  const left = result.refused.length
  state.notify(
    `Joined ${cuts} cut${cuts === 1 ? '' : 's'}.${left > 0 ? ` ${left} ${left === 1 ? 'was a real cut and was' : 'were real cuts and were'} left: ${result.refused[0]!.reason}` : ''}`
  )
}

/** A track's place among tracks of its kind, 1-based, and how many there are. */
export function trackPlace(tracks: readonly Track[], trackId: string): { place: number; count: number; kind: TrackKind } | null {
  const track = tracks.find((candidate) => candidate.id === trackId)
  if (!track) return null
  const ofKind = tracks.filter((candidate) => candidate.kind === track.kind)
  return { place: ofKind.findIndex((candidate) => candidate.id === trackId) + 1, count: ofKind.length, kind: track.kind }
}

/**
 * The place a track takes when it goes one row up or down *as the timeline lists it*. Video is
 * listed front layer first, so up the screen is a higher number; audio is listed in order, so up
 * is a lower one. Null at the end of its stack.
 */
export function placeBeside(tracks: readonly Track[], trackId: string, direction: 'up' | 'down'): number | null {
  const at = trackPlace(tracks, trackId)
  if (!at) return null
  const step = (at.kind === 'video') === (direction === 'up') ? 1 : -1
  const next = at.place + step
  return next >= 1 && next <= at.count ? next : null
}

/** Move a track one row up or down the timeline. Says why when it cannot. */
export function moveTrackBeside(trackId: string, direction: 'up' | 'down'): void {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  if (!timeline) return
  const to = placeBeside(timeline.tracks, trackId, direction)
  const track = timeline.tracks.find((candidate) => candidate.id === trackId)
  if (to === null) {
    if (track) state.notify(`“${track.name}” is already at the ${direction === 'up' ? 'top' : 'bottom'} of the ${track.kind} tracks.`)
    return
  }
  const result = state.moveTrack(trackId, to)
  if ('error' in result) state.notify(result.error, 'error')
}

/**
 * Where a dragged track lands when dropped on another's header: that track's place. Null when
 * the two are different kinds (a video track has no place among audio) or the same track.
 */
export function dropPlace(tracks: readonly Track[], draggedId: string, overId: string): number | null {
  if (draggedId === overId) return null
  const dragged = trackPlace(tracks, draggedId)
  const over = trackPlace(tracks, overId)
  if (!dragged || !over || dragged.kind !== over.kind) return null
  return over.place
}

/**
 * A track being dragged by its header, and the header it is over. Its own small store: only the
 * two headers involved re-render as the pointer moves, not the timeline.
 */
export const useTrackDrag = create<{ draggingId: string | null; overId: string | null }>(() => ({
  draggingId: null,
  overId: null
}))

/** The track whose header is under `clientY`, among headers of `kind` — found in the page, as the rows are laid out there. */
function headerAt(clientY: number, kind: TrackKind): string | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-track-header][data-track-kind="${kind}"]`)) {
    const rect = element.getBoundingClientRect()
    if (clientY >= rect.top && clientY < rect.bottom) return element.dataset.trackHeader ?? null
  }
  return null
}

/**
 * Pointer handlers for a track header's grip. A press that moves less than a few pixels is a
 * click and does nothing; past that it is a drag, the header under the pointer is marked, and
 * letting go there moves the track to that header's place (one undo step). Escape, or letting go
 * anywhere else, moves nothing.
 */
export function trackDragHandlers(track: Pick<Track, 'id' | 'kind'>): {
  onPointerDown(event: React.PointerEvent<HTMLElement>): void
} {
  return {
    onPointerDown(event) {
      if (event.button !== 0) return
      const grip = event.currentTarget
      const startY = event.clientY
      const pointerId = event.pointerId
      let dragging = false
      const finish = (drop: boolean): void => {
        grip.removeEventListener('pointermove', onMove)
        grip.removeEventListener('pointerup', onUp)
        grip.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId)
        const { overId } = useTrackDrag.getState()
        useTrackDrag.setState({ draggingId: null, overId: null })
        if (!drop || !dragging || !overId) return
        const state = useEditor.getState()
        const timeline = selectTimeline(state)
        const place = timeline ? dropPlace(timeline.tracks, track.id, overId) : null
        if (place === null) return
        const result = state.moveTrack(track.id, place)
        if ('error' in result) state.notify(result.error, 'error')
      }
      const onMove = (move: PointerEvent): void => {
        if (!dragging && Math.abs(move.clientY - startY) < 4) return
        dragging = true
        const over = headerAt(move.clientY, track.kind)
        const current = useTrackDrag.getState()
        if (current.draggingId !== track.id || current.overId !== over) useTrackDrag.setState({ draggingId: track.id, overId: over })
      }
      const onUp = (): void => finish(true)
      const onCancel = (): void => finish(false)
      const onKey = (key: KeyboardEvent): void => {
        if (key.key !== 'Escape') return
        key.stopPropagation()
        finish(false)
      }
      grip.setPointerCapture(pointerId)
      grip.addEventListener('pointermove', onMove)
      grip.addEventListener('pointerup', onUp)
      grip.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
    }
  }
}

/**
 * The track the Move Track commands act on: the first selected clip's. A linked pair selects a
 * clip on two tracks at once; the first is the one that was clicked.
 */
export function selectedTrackId(): string | null {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  const first = state.selection[0]
  if (!timeline || first === undefined) return null
  return timeline.tracks.find((track) => track.items.some((item) => item.id === first))?.id ?? null
}
