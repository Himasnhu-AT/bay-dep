/**
 * The Edit toolbar's source-to-timeline edits — Insert, Overwrite, Replace, Append and Place on
 * Top — from the clip open in the source viewer and its In and Out marks.
 *
 * The source viewer owns its asset and marks as component state. `useSourceClip` is where it
 * publishes them, so the toolbar can act on the same clip and marks the viewer's own buttons do:
 * the viewer calls `setSourceClip` when its asset or marks change and `setSourceClip(null)` when it
 * closes. Nothing here is the project or undoable.
 *
 * Insert, Overwrite and Append are exactly the viewer's own `place()` — `editIntoTimeline` and
 * `placeAssetRange` from `lib/mediaActions` — so the toolbar and the viewer cannot do two
 * different edits under one name. Replace and Place on Top are the two Resolve edits the viewer
 * does not have, and are built from the same store actions.
 */

import { create } from 'zustand'
import { assetTrackKind, findAsset, findItem, itemEnd, usToFrames, type Asset, type Item, type Timeline, type Track } from '@shared/project'
import { editIntoTimeline, endOfTimeline, placeAssetRange } from '@/lib/mediaActions'
import { insertIndexFor } from '@/lib/timelineLayout'
import { revealItem } from '@/lib/revealItem'
import { stillDurationFrames } from '@/store/editing-prefs'
import { selectTimeline, useEditor } from '@/store/editor'
import { refusableEdit } from './refusable'

export interface SourceClip {
  assetId: string
  /** The In mark, as the exact start of its frame in the source; absent is the source's start. */
  inUs?: number
  /** The Out mark (exclusive); absent is the source's end. */
  outUs?: number
}

interface SourceClipState {
  source: SourceClip | null
  setSourceClip(source: SourceClip | null): void
}

export const useSourceClip = create<SourceClipState>((set) => ({
  source: null,
  setSourceClip: (source) => set({ source })
}))

export type SourceEdit = 'insert' | 'overwrite' | 'replace' | 'append' | 'placeOnTop'

export const SOURCE_EDIT_LABEL: Record<SourceEdit, string> = {
  insert: 'Insert',
  overwrite: 'Overwrite',
  replace: 'Replace',
  append: 'Append',
  placeOnTop: 'Place on Top'
}

/** What each edit does, for its tooltip. */
export const SOURCE_EDIT_DETAIL: Record<SourceEdit, string> = {
  insert: 'Insert the source clip at the playhead; everything after it slides right on every track',
  overwrite: 'Write the source clip over the timeline at the playhead; nothing moves',
  replace: 'Replace the selected clip (or the one under the playhead) with the source clip, keeping its place and length',
  append: 'Put the source clip after the end of the timeline',
  placeOnTop: 'Put the source clip at the playhead on a free track above everything there'
}

const trackKindFor = assetTrackKind

/** The frames the marked part of `asset` takes on the timeline. */
function markedFrames(asset: Asset, source: SourceClip, fps: number): number {
  if (!(asset.durationUs > 0)) return stillDurationFrames(fps)
  const inUs = Math.max(0, source.inUs ?? 0)
  const outUs = Math.min(asset.durationUs, source.outUs ?? asset.durationUs)
  return Math.max(1, usToFrames(Math.max(0, outUs - inUs) || asset.durationUs, fps))
}

/**
 * The clip Replace acts on: the one selected clip, else the topmost clip of the source's kind
 * under the playhead on an unlocked track.
 */
function replaceTarget(timeline: Timeline, selection: readonly string[], playhead: number, kind: Track['kind']): Item | null {
  if (selection.length === 1) {
    const found = findItem(timeline, selection[0]!)
    if (found) return found.item
  }
  const tracks = timeline.tracks.filter((track) => track.kind === kind && !track.locked)
  // Video stacks with the last track in front; audio has no front, so the first will do.
  const ordered = kind === 'video' ? [...tracks].reverse() : tracks
  for (const track of ordered) {
    const under = track.items.find((item) => playhead >= item.from && playhead < itemEnd(item))
    if (under) return under
  }
  return null
}

/** Why an edit cannot run now, or null when it can. Shown as the button's tooltip when disabled. */
export function sourceEditBlocker(source: SourceClip | null): string | null {
  const state = useEditor.getState()
  if (!selectTimeline(state)) return 'No timeline is open.'
  if (!source) return 'Open a clip in the source viewer first: click it in the Media Pool.'
  const asset = findAsset(state.project, source.assetId)
  if (!asset) return 'The source clip is no longer in the project.'
  if (asset.error) return `${asset.name} cannot be read, so it cannot be edited in.`
  if (asset.kind === 'font' || asset.kind === 'lut') return `${asset.name} is not something that plays on a track.`
  return null
}

/** Runs one source edit and says what it did. Returns the new clip's id, or null. */
export function runSourceEdit(edit: SourceEdit): string | null {
  const store = useEditor.getState()
  const source = useSourceClip.getState().source
  const blocked = sourceEditBlocker(source)
  if (blocked || !source) {
    store.notify(blocked ?? 'Open a clip in the source viewer first.')
    return null
  }
  const asset = findAsset(store.project, source.assetId)!
  const timeline = selectTimeline(store)!
  const range = {
    ...(source.inUs !== undefined ? { inUs: source.inUs } : {}),
    ...(source.outUs !== undefined ? { outUs: source.outUs } : {})
  }
  let placed: string | null = null
  let said = ''
  switch (edit) {
    case 'insert':
    case 'overwrite':
      placed = editIntoTimeline(asset, edit, range)
      said = edit === 'insert' ? 'inserted at the playhead' : 'written over the playhead'
      break
    case 'append':
      placed = placeAssetRange(asset, { atFrame: endOfTimeline(), ...range })
      said = 'appended to the end'
      break
    case 'placeOnTop':
      placed = placeOnTop(asset, source, timeline)
      said = 'placed on top at the playhead'
      break
    case 'replace': {
      const result = replaceWith(asset, source, timeline)
      if ('error' in result) {
        store.notify(result.error)
        return null
      }
      placed = result.itemId
      said = `put in place of ${result.replaced}`
      break
    }
  }
  if (placed) {
    revealItem(placed)
    store.notify(`${asset.name} ${said}. ⌘Z to undo.`)
  }
  return placed
}

/**
 * Place on Top: at the playhead, on the lowest track of the source's kind that is free for the
 * clip's length and has nothing above it there — a new track at the top when there is none.
 */
function placeOnTop(asset: Asset, source: SourceClip, timeline: Timeline): string | null {
  const store = useEditor.getState()
  const at = store.playhead
  const frames = markedFrames(asset, source, timeline.fps)
  const kind = trackKindFor(asset)
  const ofKind = timeline.tracks.filter((track) => track.kind === kind)
  // Front to back for video (the last track is in front); audio in its own order.
  const frontToBack = kind === 'video' ? [...ofKind].reverse() : ofKind
  const busy = (track: Track): boolean => track.items.some((item) => item.from < at + frames && itemEnd(item) > at)
  // The free tracks in front of the frontmost busy one.
  const frontmostBusy = frontToBack.findIndex(busy)
  const candidates = (frontmostBusy === -1 ? frontToBack : frontToBack.slice(0, frontmostBusy)).filter((track) => !track.locked)
  const target = candidates.at(-1)
  let placed: string | null = null
  store.transact(() => {
    let trackId = target?.id
    if (!trackId) {
      const front = frontToBack[0]
      trackId = store.addTrack(kind, front ? insertIndexFor(timeline.tracks, front.id, 'above') : undefined)
    }
    placed = placeAssetRange(asset, { atFrame: at, trackId, inUs: source.inUs, outUs: source.outUs })
  })
  return placed
}

/**
 * Replace: the source's In point goes where the target clip starts, for the target's length (or
 * the marked part's, if shorter), on the target's track — the target is removed. Refused for a
 * linked clip, whose partner would be left describing footage that is no longer there.
 */
function replaceWith(asset: Asset, source: SourceClip, timeline: Timeline): { itemId: string; replaced: string } | { error: string } {
  const store = useEditor.getState()
  const kind = trackKindFor(asset)
  const target = replaceTarget(timeline, store.selection, store.playhead, kind)
  if (!target) {
    return { error: 'Select the clip to replace, or put the playhead over one on an unlocked track.' }
  }
  const found = findItem(timeline, target.id)
  if (!found) return { error: 'That clip is no longer on the timeline.' }
  if (found.track.locked) return { error: `${found.track.name} is locked. Unlock it to replace the clip.` }
  if (found.track.kind !== kind) {
    return { error: `${asset.name} is ${kind === 'video' ? 'a picture' : 'sound'}, and the clip to replace is on ${found.track.name}, a ${found.track.kind} track.` }
  }
  if (target.linkId) return { error: 'That clip is linked to its sound. Unlink it first (right-click › Audio › Unlink), then replace it.' }
  const replaced = findAsset(store.project, target.assetId)?.name ?? 'the clip'
  // A still takes the target's length; footage the target's or the marked part's, if shorter.
  // Always passed, so the room `placeAsset` looks for is exactly the room the target leaves: a
  // still placed at the default still length found the next clip in the way and landed on
  // another track.
  const footage = asset.durationUs > 0
  const length = footage ? Math.min(target.durationInFrames, markedFrames(asset, source, timeline.fps)) : target.durationInFrames
  const span = { sourceStartUs: footage ? Math.max(0, source.inUs ?? 0) : 0, durationInFrames: length }
  let placed: string | null = null
  // Refused inside the step if it did not land in the target's place, so the target is not left
  // deleted with nothing where it was (`refusableEdit` puts the project back as it was).
  const refused = refusableEdit(() => {
    store.select([target.id])
    store.deleteSelected()
    placed = store.placeAsset(asset.id, target.from, found.track.id, span)
    const landed = placed ? findItem(selectTimeline(useEditor.getState())!, placed) : undefined
    if (!landed || landed.track.id !== found.track.id || landed.item.from !== target.from) {
      placed = null
      return `${asset.name} could not be placed in ${replaced}’s place on ${found.track.name}.`
    }
    store.select([landed.item.id])
    return null
  })
  if (refused !== null || !placed) return { error: refused ?? `${asset.name} could not be placed there.` }
  return { itemId: placed, replaced }
}
