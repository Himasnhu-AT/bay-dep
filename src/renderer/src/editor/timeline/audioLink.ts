/**
 * Detach, reattach and unlink a clip's sound — the clip menu's Audio rows and the Edit toolbar's
 * Detach/Link Audio button, which must agree on when each applies. Each runs the store action the
 * `detach_audio` tool does; a refusal comes back with its reason and is shown as it comes.
 */

import { findAsset, findItem, findTimeline, type Project, type Timeline } from '@shared/project'
import { linkedPartners } from '@shared/links'
import { useEditor } from '@/store/editor'

/** A clip whose picture carries sound that could go onto its own audio clip. */
export function canDetachAudio(project: Project, timeline: Timeline, itemId: string): boolean {
  const found = findItem(timeline, itemId)
  if (!found || found.track.kind !== 'video' || found.item.audioDetached) return false
  const asset = findAsset(project, found.item.assetId)
  return Boolean(asset?.hasVideo && asset.hasAudio && !asset.error)
}

/** A picture whose sound was detached, or that detached sound: reattaching puts it back. */
export function canReattachAudio(timeline: Timeline, itemId: string): boolean {
  const found = findItem(timeline, itemId)
  if (!found) return false
  return Boolean(found.item.audioDetached || linkedPartners(timeline, itemId).some((partner) => partner.audioDetached))
}

export function isLinked(timeline: Timeline, itemId: string): boolean {
  return linkedPartners(timeline, itemId).length > 0
}

/**
 * What the toolbar's audio button offers for `selection`: Detach while any selected picture
 * carries sound, else Link when there is sound to put back, else nothing.
 */
export function audioLinkOffer(project: Project, selection: readonly string[]): 'detach' | 'reattach' | null {
  const timeline = findTimeline(project, project.activeTimelineId)
  if (!timeline || selection.length === 0) return null
  if (selection.some((id) => canDetachAudio(project, timeline, id))) return 'detach'
  if (selection.some((id) => canReattachAudio(timeline, id))) return 'reattach'
  return null
}

/**
 * `audioLinkOffer`, remembered for the last project and selection by identity (every edit makes
 * a new project, every selection change a new array). For a store selector, which runs on every
 * store change — each playback frame included — while the answer changes only with these two.
 */
export function memoAudioLink(): (project: Project, selection: readonly string[]) => 'detach' | 'reattach' | null {
  let last: { project: Project; selection: readonly string[]; offer: 'detach' | 'reattach' | null } | null = null
  return (project, selection) => {
    if (last && last.project === project && last.selection === selection) return last.offer
    const offer = audioLinkOffer(project, selection)
    last = { project, selection, offer }
    return offer
  }
}

export type AudioLinkAction = 'detach' | 'reattach' | 'unlink'

/** Runs one of the three on `itemIds`, and says why when the store refuses. */
export function runAudioLink(action: AudioLinkAction, itemIds: string[]): void {
  const store = useEditor.getState()
  if (itemIds.length === 0) return
  if (action === 'unlink') {
    store.unlinkItems(itemIds)
    return
  }
  const refused = action === 'detach' ? store.detachAudio(itemIds).refused : store.reattachAudio(itemIds).refused
  if (refused.length > 0) store.notify(refused.map((r) => r.forPerson).join(' '), 'error')
}
