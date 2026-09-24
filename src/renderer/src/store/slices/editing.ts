/**
 * The keyboard editing verbs: the clip clipboard, Paste Attributes, enable/disable, nudge, close
 * gap, trim to playhead and Remove In/Out. The planning is in `@shared/editing` and
 * `@shared/clipboard`; this applies a plan through `edit()` and turns a refusal into a toast that
 * says what is in the way.
 */

import { activeTimeline, findItem, itemEnd, timelineDuration, type Item } from '@shared/project'
import { attributePatch, copyClips, pasteClips } from '@shared/clipboard'
import { applyMoves, clipsUnderPlayhead, planCloseGap, planNudge, planPullBack } from '@shared/editing'
import { linkedPartners, withLinked } from '@shared/links'
import { applyFreezeFrame, freezeRefusal, type FreezeResult } from '@shared/freeze-frame'
import { applyTrackMoves, checkTrackMoves } from '@shared/track-move'
import { makeTrack, newId, nextTrackName } from '../factory'
import type { EditorActions } from '../types'
import type { StoreKit } from '../kit'

type Actions = Pick<
  EditorActions,
  | 'copySelection'
  | 'cutSelection'
  | 'paste'
  | 'pasteAttributes'
  | 'toggleDisabled'
  | 'nudgeSelection'
  | 'moveItemsToTracks'
  | 'closeGapAt'
  | 'trimToPlayhead'
  | 'removeInOutRange'
  | 'setClipDialog'
  | 'insertFreezeFrame'
>

/** Fields a patch set to `undefined` are removed, so "no grade" is stored as absence. */
function assignPatch(item: Item, patch: Partial<Item>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete (item as unknown as Record<string, unknown>)[key]
    else (item as unknown as Record<string, unknown>)[key] = value
  }
}

export function editingSlice({ set, get, edit, editTimeline, currentTimeline }: StoreKit): Actions {
  return {
    copySelection() {
      const state = get()
      const timeline = currentTimeline()
      if (!timeline || state.selection.length === 0) {
        state.notify('Select the clips to copy first.')
        return 0
      }
      const ids = state.linkedSelection ? withLinked(timeline, state.selection) : state.selection
      const payload = copyClips(state.project, timeline, ids)
      if (!payload) return 0
      set({ clipboard: payload })
      return payload.items.length
    },

    cutSelection() {
      if (get().copySelection() === 0) return
      get().deleteSelected()
    },

    paste(at, trackId) {
      const state = get()
      const payload = state.clipboard
      if (!payload) {
        state.notify('Nothing to paste. Copy clips with ⌘C first.')
        return []
      }
      const holder: { value: ReturnType<typeof pasteClips> | null } = { value: null }
      editTimeline((timeline, project) => {
        holder.value = pasteClips(project, timeline, payload, at ?? state.playhead, {
          ...(trackId ? { trackId } : {}),
          makeId: newId,
          makeTrack: (tl, kind) => {
            const track = makeTrack(kind, 1)
            track.name = nextTrackName(tl, kind)
            return track
          }
        })
      })
      const result = holder.value
      if (!result) return []
      if (!result.ok) {
        state.notify(result.error, 'error')
        return []
      }
      set({ selection: result.itemIds })
      if (result.createdTrackIds.length > 0) {
        state.notify('The original tracks had no room there, so the paste went onto a new track.')
      }
      return result.itemIds
    },

    pasteAttributes(attributes) {
      const state = get()
      const source = state.clipboard?.items[0]
      if (!source) {
        state.notify('Copy a clip first (⌘C), then paste its attributes onto others.')
        return 0
      }
      if (state.selection.length === 0) {
        state.notify('Select the clips to paste attributes onto.')
        return 0
      }
      if (attributes.length === 0) return 0
      const chosen = new Set(attributes)
      let changed = 0
      editTimeline((timeline) => {
        for (const id of state.selection) {
          const found = findItem(timeline, id)
          if (!found || found.track.locked) continue
          assignPatch(found.item, attributePatch(source, found.item, chosen))
          changed += 1
          // Speed is a sync field: a linked sound follows its picture's rate, as in `patchItem`.
          if (chosen.has('speed')) {
            for (const partner of linkedPartners(timeline, id)) partner.speed = source.speed
          }
        }
      })
      if (changed === 0) state.notify('The selected clips are on locked tracks. Unlock them to paste attributes.', 'error')
      return changed
    },

    toggleDisabled(itemIds) {
      const state = get()
      const timeline = currentTimeline()
      const ids = itemIds ?? state.selection
      if (!timeline || ids.length === 0) {
        state.notify('Select the clips to enable or disable first.')
        return
      }
      const group = withLinked(timeline, ids)
      const items = group.map((id) => findItem(timeline, id)?.item).filter((item): item is Item => Boolean(item))
      // Any clip still on means "switch them off"; all off means "switch them back on".
      const disable = items.some((item) => !item.disabled)
      editTimeline((tl) => {
        for (const id of group) {
          const found = findItem(tl, id)
          if (!found || found.track.locked) continue
          if (disable) found.item.disabled = true
          else delete found.item.disabled
        }
      })
    },

    nudgeSelection(delta) {
      const state = get()
      const timeline = currentTimeline()
      if (!timeline) return false
      const plan = planNudge(state.project, timeline, state.selection, delta, state.linkedSelection)
      if (!plan.ok) {
        state.notify(plan.error, 'error')
        return false
      }
      if (plan.moves.length > 0) editTimeline((tl) => applyMoves(tl, plan.moves))
      return true
    },

    moveItemsToTracks(moves) {
      const state = get()
      const timeline = currentTimeline()
      if (!timeline) return { error: 'No timeline is open.' }
      // Checked again against the timeline as it is now: the plan was made during a drag.
      const checked = checkTrackMoves(state.project, timeline, moves)
      if (!checked.ok) return { error: checked.error }
      if (checked.moves.length > 0) editTimeline((tl) => applyTrackMoves(tl, checked.moves))
      return { ok: true }
    },

    closeGapAt(trackId, frame) {
      const state = get()
      const timeline = currentTimeline()
      if (!timeline) return { error: 'No timeline is open.' }
      const plan = planCloseGap(state.project, timeline, trackId, frame)
      if (!plan.ok) return { error: plan.error }
      editTimeline((tl) => applyMoves(tl, plan.moves))
      return { closedFrames: plan.gap.to - plan.gap.from, from: plan.gap.from, to: plan.gap.to }
    },

    trimToPlayhead(edge, ripple) {
      const state = get()
      const timeline = currentTimeline()
      if (!timeline) return
      const at = state.playhead
      const targets = clipsUnderPlayhead(timeline, state.selection, at)
      if (targets.length === 0) {
        state.notify(
          state.selection.length > 0
            ? 'The playhead is not inside a selected clip. Move it into the clip, or clear the selection to trim whatever it crosses.'
            : 'The playhead is not inside a clip on an unlocked track.'
        )
        return
      }
      const refusals: string[] = []
      const blocked: string[] = []
      state.transact(() => {
        for (const target of targets) {
          const before = findItem(activeTimeline(get().project)!, target.id)?.item
          get().trimItem(target.id, edge, at)
          const now = activeTimeline(get().project)!
          const after = findItem(now, target.id)?.item
          if (!before || !after || (after.from === before.from && after.durationInFrames === before.durationInFrames)) {
            refusals.push(target.id)
            continue
          }
          if (!ripple) continue
          // Only the trimmed-off frames are closed up, never a gap that was already there: a Q trim
          // pulls the clip (and what follows) back by what was cut from its head; a W trim pulls
          // back what followed its old end.
          const plan =
            edge === 'start'
              ? planPullBack(get().project, now, target.trackId, after.from, after.from - before.from)
              : planPullBack(get().project, now, target.trackId, itemEnd(before), itemEnd(before) - itemEnd(after))
          if (!plan.ok) {
            blocked.push(plan.error)
            continue
          }
          editTimeline((tl) => applyMoves(tl, plan.moves))
        }
      })
      if (ripple && edge === 'start' && refusals.length < targets.length && blocked.length === 0) {
        // The frame that was under the playhead moved back to where the clip now starts.
        const first = targets[0]
        const moved = first ? findItem(activeTimeline(get().project)!, first.id)?.item : undefined
        if (moved) get().setPlayhead(moved.from)
      }
      if (blocked.length > 0) {
        state.notify(`Trimmed, but the gap was left open: ${blocked[0]}`, 'error')
      }
      if (refusals.length > 0) {
        state.notify(
          'Some clips could not be trimmed: a linked clip is on a locked track, or would run into its neighbour. ' +
            'Unlock the track, or unlink the clips to trim one alone.',
          'error'
        )
      }
    },

    removeInOutRange() {
      const state = get()
      const timeline = currentTimeline()
      if (!timeline) return
      if (state.rangeIn === null && state.rangeOut === null) {
        state.notify('Mark a range first: I sets In, O sets Out.')
        return
      }
      const from = state.rangeIn ?? 0
      const to = state.rangeOut ?? timelineDuration(timeline)
      if (to <= from) {
        state.notify('The range is empty. Set Out after In.')
        return
      }
      // The same store call the `remove_range` tool makes, so a person and an agent removing the
      // same span get the same timeline — and the same named warning about locked tracks.
      const result = state.rippleDelete(from, to)
      if (!result || result.removedFrames === 0) {
        state.notify(`Nothing occupies frames ${from}–${to}, so there was nothing to remove.`)
        return
      }
      set({ rangeIn: null, rangeOut: null })
    },

    setClipDialog(dialog) {
      set({ clipDialog: dialog })
    },

    insertFreezeFrame({ itemId, frame, frames, still }) {
      const timeline = currentTimeline()
      const found = timeline ? findItem(timeline, itemId) : undefined
      if (!timeline || !found) return { error: 'That clip is no longer on the timeline.' }
      const refusal = freezeRefusal(timeline, found.item, frame)
      if (refusal) return { error: refusal }
      // One `edit()`: the asset and the timeline change land together and undo together.
      const holder: { value: FreezeResult | null } = { value: null }
      edit((project) => {
        if (!project.assets.some((asset) => asset.id === still.id)) project.assets.push(still)
        const tl = activeTimeline(project)
        if (tl) holder.value = applyFreezeFrame(tl, { itemId, frame, frames, still }, newId)
      })
      const result = holder.value
      if (!result) return { error: 'That clip is no longer under the playhead.' }
      set({ selection: [result.freezeItemId] })
      return result
    }
  }
}
