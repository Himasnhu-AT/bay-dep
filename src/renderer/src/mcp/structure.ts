/**
 * `move_track`, `join_items` and `read_history`: the shape of the timeline and of its history.
 *
 * Each is thin over a store action that already refuses with a reason (`@shared/track-order`,
 * `@shared/heal`, `@shared/history`); what this file adds is the ids resolved the way every tool
 * resolves them, and an answer that says what the timeline is now rather than only that the call
 * worked.
 */

import { itemEnd } from '@shared/project'
import { refusalText } from '@shared/heal'
import { actorLabel, historyView } from '@shared/history'
import { trackNumbers } from '@shared/track-order'
import { stepNote } from '@/store/history-notes'
import { fail, resolveItem, resolveTrack, store, timeline, type Handlers } from './helpers'

/** The stacks as they stand, lowest first, for an answer the next call can be written from. */
function stacks(): Record<string, unknown> {
  const tracks = timeline().tracks
  const numbers = trackNumbers(tracks)
  const list = (kind: 'video' | 'audio'): unknown[] =>
    tracks
      .filter((track) => track.kind === kind)
      .map((track) => ({ trackId: track.id, number: numbers.get(track.id), name: track.name, items: track.items.length }))
  return { video: list('video'), audio: list('audio') }
}

export function moveTrack(args: Record<string, unknown>): Record<string, unknown> {
  const track = resolveTrack(String(args.trackId))
  let moved: ReturnType<ReturnType<typeof store>['moveTrack']> | null = null
  store().transact(() => {
    moved = store().moveTrack(track.id, Number(args.position))
  })
  const result = moved as ReturnType<ReturnType<typeof store>['moveTrack']> | null
  if (!result) fail('The track was not moved.')
  if ('error' in result) fail(result.error)
  const letter = result.kind === 'video' ? 'V' : 'A'
  return {
    trackId: result.trackId,
    kind: result.kind,
    from: `${letter}${result.from}`,
    to: `${letter}${result.to}`,
    ...(result.renamed.length > 0 ? { renamed: result.renamed } : {}),
    tracks: stacks(),
    note:
      result.kind === 'video'
        ? `Video tracks are listed lowest first: each draws over the ones before it. The ${track.items.length} clip${
            track.items.length === 1 ? '' : 's'
          } on the track moved with it; no clip changed its time.`
        : 'Audio tracks have no stacking, so the mix is unchanged; this is the order they are listed in. No clip changed its time.'
  }
}

export function joinItems(args: Record<string, unknown>): Record<string, unknown> {
  const given = Array.isArray(args.itemIds) ? args.itemIds.map(String) : []
  if (given.length === 0) fail('Name the clips to join in itemIds: the clip on each side of a cut, or one clip to join it to the next.')
  const ids = [...new Set(given.map((id) => resolveItem(id).item.id))]
  let outcome: ReturnType<ReturnType<typeof store>['joinItems']> | null = null
  store().transact(() => {
    outcome = store().joinItems(ids, args.linked === false ? { linked: false } : {})
  })
  const result = outcome as ReturnType<ReturnType<typeof store>['joinItems']> | null
  if (!result) fail('Nothing was joined.')
  if ('error' in result) {
    // A lone clip with nothing after it: say what is there, since that is what the next call needs.
    const only = ids.length === 1 ? resolveItem(ids[0]!) : null
    const after = only
      ? only.track.items
          .filter((item) => item.from >= itemEnd(only.item))
          .sort((a, b) => a.from - b.from)[0]
      : undefined
    const said = result.hint ? `${result.error} ${result.hint}` : result.error
    // The second argument is the same refusal for a person: the inspector and commands show it.
    fail(after && !result.hint ? `${said} The next clip on ${only!.track.name} is ${after.id}, at frame ${after.from}.` : said, result.error)
  }
  return {
    joined: result.joined.map((join) => ({
      itemId: join.itemId,
      removedItemId: join.removedId,
      trackId: join.trackId,
      from: join.from,
      durationInFrames: join.durationInFrames
    })),
    ...(result.refused.length > 0
      ? {
          leftAsCuts: result.refused.map((refusal) => ({ itemIds: [refusal.leftId, refusal.rightId], why: refusalText(refusal) })),
          warning: `${result.refused.length} of the cuts named ${result.refused.length === 1 ? 'is a real cut and was' : 'are real cuts and were'} left alone; see leftAsCuts.`
        }
      : {}),
    note: 'Each joined clip keeps the id of the earlier one; the later id no longer exists.'
  }
}

export function readHistory(): Record<string, unknown> {
  const state = store()
  const view = historyView(state.past, state.project, state.future, stepNote)
  return {
    position: view.position,
    steps: view.steps.map((step) => ({
      position: step.position,
      did: step.label,
      by: actorLabel(step.actor) ?? 'User',
      applied: step.applied
    })),
    note:
      view.steps.length === 0
        ? 'No change has been made to this project in this session, so there is nothing to undo.'
        : `The project is at position ${view.position} of ${view.steps.length}. undo with position N leaves the first N changes applied; 0 is before all of them.`
  }
}

export const handlers: Handlers = {
  move_track: (args) => moveTrack(args),
  join_items: (args) => joinItems(args),
  read_history: () => readHistory()
}
