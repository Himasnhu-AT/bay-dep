/**
 * Detach, reattach and unlink a clip's sound — the clip menu's Audio rows and the Edit toolbar's
 * Detach/Link Audio button, which must agree on when each applies. Each runs the store action the
 * `detach_audio` tool does; a refusal comes back with its reason and is shown as it comes.
 */

import { findAsset, findItem, type Project, type Timeline } from '@shared/project'
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
