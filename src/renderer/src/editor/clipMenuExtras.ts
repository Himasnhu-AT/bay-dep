/**
 * The clip menu's rows for the timeline's less visible edits: the per-track ripple delete, the
 * trim modes (slip, slide, roll) armed for the next drag, and detaching a clip's sound onto a
 * chosen track. Each calls the same function the agent's tool does — `deleteItems` for
 * `delete_items({ ripple: true })`, `detachAudio` for `detach_audio({ trackId })` — so the menu
 * and the agent cannot close different gaps or put sound on different tracks.
 */

import type { Item, Timeline } from '@shared/project'
import type { TrimMode } from '@shared/trim'
import type { MenuEntry } from '@/components'
import { TRIM_MODE_LABEL, useTimelineTool } from '@/lib/timelineTool'
import { deleteItems } from '@/mcp/write'
import { useEditor } from '@/store/editor'

/**
 * "Ripple Delete (This Track Only)": deletes the selection and closes the gap on each track it
 * deleted from, and nowhere else. The toast names the tracks it left out of sync, which is the
 * difference from ⇧Delete (which removes the time from every track and keeps them in sync).
 */
export function rippleDeleteThisTrack(): void {
  const store = useEditor.getState()
  if (store.selection.length === 0) {
    store.notify('Select the clips to delete first.')
    return
  }
  try {
    const result = deleteItems({ itemIds: [...store.selection], ripple: true })
    const deleted = Array.isArray(result.deleted) ? result.deleted.length : 0
    const note = typeof result.note === 'string' ? result.note : null
    store.notify(
      note
        ? `Deleted ${deleted} clip${deleted === 1 ? '' : 's'}. ${note}`
        : `Deleted ${deleted} clip${deleted === 1 ? '' : 's'}. Nothing came after ${deleted === 1 ? 'it' : 'them'}, so there was no gap to close.`
    )
  } catch (error) {
    store.notify(error instanceof Error ? error.message : String(error), 'error')
  }
}

const ARM_HINT: Record<TrimMode, string> = {
  slip: 'Drag a clip to slip its footage. Next time, ⌥-drag the clip.',
  slide: 'Drag a clip to slide it between its neighbours. Next time, ⌥⇧-drag the clip.',
  roll: 'Drag a clip edge (or near one) to roll that cut. Next time, ⌥-drag the edge.'
}

/** Slip…, Slide…, Roll Edit…: arm the next drag, and say how to do it without the menu. */
export function trimModeEntries(locked: boolean): MenuEntry[] {
  const arm = (mode: TrimMode) => () => {
    useTimelineTool.getState().arm(mode)
    useEditor.getState().notify(`${TRIM_MODE_LABEL[mode]} armed. ${ARM_HINT[mode]} Escape cancels.`)
  }
  return [
    { label: 'Slip…', disabled: locked, onSelect: arm('slip') },
    { label: 'Slide…', disabled: locked, onSelect: arm('slide') },
    { label: 'Roll Edit…', disabled: locked, onSelect: arm('roll') }
  ]
}

/**
 * Detaching the sound of `item` onto a chosen audio track, or a new one. `detachAudio` with a
 * track id is what `detach_audio({ trackId })` runs; a refusal (the track is busy there, or
 * locked) comes back with its reason and is shown as it comes.
 */
export function detachToEntries(item: Item, timeline: Timeline, canDetach: boolean): MenuEntry[] {
  if (!canDetach) return []
  const detach = (trackId: string | 'new') => () => {
    const store = useEditor.getState()
    let refused: { reason: string }[] = []
    store.transact(() => {
      const target = trackId === 'new' ? store.addTrack('audio') : trackId
      refused = store.detachAudio([item.id], target).refused
      // A refused detach leaves no empty track behind it.
      if (refused.length > 0 && trackId === 'new') store.removeTrack(target)
    })
    if (refused.length > 0) store.notify(refused.map((r) => r.reason).join('. ') + '.', 'error')
  }
  const audioTracks = timeline.tracks.filter((track) => track.kind === 'audio')
  return [
    { kind: 'label', label: 'Detach audio to' },
    ...audioTracks.map(
      (track): MenuEntry => ({
        label: track.locked ? `${track.name} (locked)` : track.name,
        disabled: track.locked,
        onSelect: detach(track.id)
      })
    ),
    { label: 'New audio track', onSelect: detach('new') }
  ]
}
