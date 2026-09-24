/**
 * `detach_audio` — separate a clip's sound from its picture, unlink a pair, or put it back.
 *
 * The pure work is `@shared/links`; this file resolves ids, refuses before changing anything when
 * nothing would change (a refusal that reaches `edit()` is still a no-op, but an agent must hear
 * why), and reports each pair in the units the rest of the surface uses.
 */

import { allItems, itemEnd } from '@shared/project'
import { resolveId } from '@shared/mcp'
import { linkedPartners, type LinkRefusal } from '@shared/links'
import { fail, resolveTrack, store, timeline, type Handlers } from './helpers'

/** A refusal as the agent reads it: ids and the tool's own words; `forPerson` is the UI's. */
function forAgent(refusal: LinkRefusal): Record<string, unknown> {
  return {
    itemId: refusal.itemId,
    reason: refusal.reason,
    ...(refusal.conflict ? { conflict: refusal.conflict } : {})
  }
}

function resolveIds(given: readonly string[]): string[] {
  const known = allItems(timeline()).map((i) => i.id)
  return given.map((each) => {
    const resolved = resolveId(each, known)
    if (!resolved.ok) fail(resolved.error)
    return resolved.id
  })
}

export function detachAudioTool(args: Record<string, unknown>): Record<string, unknown> {
  const ids = resolveIds(args.itemIds as string[])
  if (ids.length === 0) fail('No itemIds were given, so there is nothing to detach.')
  const action = (args.action as string | undefined) ?? 'detach'

  if (action === 'unlink') {
    if (args.trackId !== undefined) fail('trackId applies to detach only; unlink moves nothing.')
    const linked = ids.filter((id) => linkedPartners(timeline(), id).length > 0)
    if (linked.length === 0) {
      fail(`${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} not linked to anything, so there is nothing to unlink.`)
    }
    let unlinked: string[] = []
    store().transact(() => {
      unlinked = store().unlinkItems(ids)
    })
    return {
      action,
      unlinked,
      note:
        'Each is now edited alone: a move, trim or delete of one leaves the other where it is. A ' +
        'detached picture still plays no sound — its sound is the audio item.'
    }
  }

  if (action === 'reattach') {
    if (args.trackId !== undefined) fail('trackId applies to detach only.')
    let result: ReturnType<ReturnType<typeof store>['reattachAudio']> | null = null
    store().transact(() => {
      result = store().reattachAudio(ids)
    })
    const done = result as ReturnType<ReturnType<typeof store>['reattachAudio']> | null
    if (!done || done.reattached.length === 0) {
      fail(
        (done?.refused ?? []).map((r) => `${r.itemId}: ${r.reason}.`).join(' ') ||
          'Nothing was reattached.'
      )
    }
    return {
      action,
      reattached: done.reattached.map((r) => ({ itemId: r.pictureId, removedAudioItemIds: r.removedAudioIds })),
      ...(done.refused.length > 0 ? { refused: done.refused.map(forAgent) } : {})
    }
  }

  const trackId = args.trackId === undefined ? undefined : resolveTrack(String(args.trackId)).id
  let result: ReturnType<ReturnType<typeof store>['detachAudio']> | null = null
  store().transact(() => {
    result = store().detachAudio(ids, trackId)
  })
  const done = result as ReturnType<ReturnType<typeof store>['detachAudio']> | null
  if (!done || done.detached.length === 0) {
    fail(
      (done?.refused ?? []).map((r) => `${r.itemId}: ${r.reason}.`).join(' ') || 'Nothing was detached.'
    )
  }
  const tl = timeline()
  const trackName = (id: string): string => tl.tracks.find((t) => t.id === id)?.name ?? id
  return {
    action: 'detach',
    detached: done.detached.map((pair) => {
      const audio = allItems(tl).find((i) => i.id === pair.audioId)
      return {
        itemId: pair.pictureId,
        audioItemId: pair.audioId,
        audioTrackId: pair.trackId,
        audioTrackName: trackName(pair.trackId),
        ...(audio ? { from: audio.from, endFrame: itemEnd(audio) } : {})
      }
    }),
    ...(done.createdTrackIds.length > 0
      ? { createdTracks: done.createdTrackIds.map((id) => ({ trackId: id, name: trackName(id) })) }
      : {}),
    ...(done.addedTransitionIds.length > 0 ? { copiedTransitionIds: done.addedTransitionIds } : {}),
    ...(done.refused.length > 0 ? { refused: done.refused.map(forAgent) } : {}),
    ...(done.warnings.length > 0 ? { warnings: done.warnings } : {}),
    note:
      'The pictures play no sound now; each audio item carries it, linked. Fade, level or duck the ' +
      'sound with edit_item on audioItemId; fades on the picture fade only the picture.'
  }
}

export const handlers: Handlers = {
  detach_audio: (args) => detachAudioTool(args)
}
