/**
 * `apply_text_look`: one look over many titles, as one undo step.
 *
 * The inspector's "Apply to all on this track / on the timeline" calls this same function, so
 * what a person does with the button and what the agent does with the tool are one edit — the
 * same titles chosen, the same ones skipped, the same sentence when nothing changed.
 */

import { findAsset, type Item, type TextStyle, type Track } from '@shared/project'
import { applyTextLook, copyTextLook, findTextLook, TEXT_LOOKS } from '@shared/text-style'
import { resolvedTextStyle } from '@/engine/text'
import { fail, project, resolveItem, resolveTrack, store, timeline, type Handlers } from './helpers'

interface Target {
  item: Item
  track: Track
}

export function applyTextLookTool(args: Record<string, unknown>): Record<string, unknown> {
  const isTitle = (item: Item): boolean => findAsset(project(), item.assetId)?.kind === 'text'

  // -- which look -------------------------------------------------------------------------------
  const givenLook = args.look !== undefined
  const givenSource = args.fromItemId !== undefined
  if (givenLook === givenSource) {
    fail(
      'Give exactly one of look or fromItemId. look is a named style — ' +
        `${TEXT_LOOKS.map((look) => `"${look.id}"`).join(', ')} — and fromItemId copies the look of a title you have already styled.`
    )
  }
  let restyle: (style: TextStyle) => TextStyle
  let named: string
  let sourceId: string | null = null
  if (givenLook) {
    const look = typeof args.look === 'string' ? findTextLook(args.look) : undefined
    if (!look) fail(`look is ${JSON.stringify(args.look)}; the looks are ${TEXT_LOOKS.map((one) => `"${one.id}"`).join(', ')}.`)
    restyle = (style) => applyTextLook(style, look)
    named = look.id
  } else {
    const source = resolveItem(String(args.fromItemId))
    if (!isTitle(source.item)) {
      fail(`fromItemId ${source.item.id} is not a title, so it has no look to copy. Name a text item, or give look instead.`)
    }
    const sourceStyle = resolvedTextStyle(source.item)
    restyle = (style) => copyTextLook(style, sourceStyle)
    named = `the look of ${source.item.id}`
    sourceId = source.item.id
  }

  // -- which titles -----------------------------------------------------------------------------
  const scopes = [args.itemIds !== undefined, args.trackId !== undefined, args.all === true].filter(Boolean).length
  if (scopes !== 1) {
    fail('Say which titles, one way: itemIds (exactly these), trackId (every title on that track) or all: true (every title on the timeline).')
  }
  const tl = timeline()
  let targets: Target[]
  let scope: string
  if (args.itemIds !== undefined) {
    const ids = args.itemIds as unknown[]
    targets = ids.map((id) => resolveItem(String(id)))
    const strangers = targets.filter((target) => !isTitle(target.item))
    if (strangers.length > 0) {
      fail(
        `${strangers.map((target) => target.item.id).join(', ')} ${strangers.length === 1 ? 'is not a title' : 'are not titles'}, so there is no type to style. ` +
          `Leave ${strangers.length === 1 ? 'it' : 'them'} out — or pass trackId or all: true, which skip anything that is not a title.`
      )
    }
    scope = `${targets.length} named title${targets.length === 1 ? '' : 's'}`
  } else if (args.trackId !== undefined) {
    const track = resolveTrack(String(args.trackId))
    targets = track.items.filter(isTitle).map((item) => ({ item, track }))
    scope = `track ${track.name}`
    if (targets.length === 0) {
      const withTitles = tl.tracks.filter((other) => other.items.some(isTitle))
      fail(
        `Track ${track.name} (${track.id}) has no titles on it. ` +
          (withTitles.length > 0
            ? `Tracks with titles: ${withTitles.map((other) => `${other.name} (${other.id})`).join(', ')}.`
            : 'There are no titles on this timeline yet.')
      )
    }
  } else {
    targets = tl.tracks.flatMap((track) => track.items.filter(isTitle).map((item) => ({ item, track })))
    scope = 'the timeline'
    if (targets.length === 0) fail('There are no titles on this timeline, so there is nothing to restyle.')
  }

  // The title a look is copied from already wears it.
  const wanted = targets.filter((target) => target.item.id !== sourceId)
  const locked = wanted.filter((target) => target.track.locked)
  const open = wanted.filter((target) => !target.track.locked)
  if (open.length === 0 && locked.length > 0) {
    fail(
      `Every title in ${scope} is on a locked track (${[...new Set(locked.map((target) => target.track.name))].join(', ')}), so nothing can be restyled. Unlock the track first.`
    )
  }

  const changed: string[] = []
  const unchanged: string[] = []
  store().transact(() => {
    for (const { item } of open) {
      const before = resolvedTextStyle(item)
      const after = restyle(before)
      if (item.text && JSON.stringify(item.text) === JSON.stringify(after)) {
        unchanged.push(item.id)
        continue
      }
      store().patchItem(item.id, { text: after }, { linked: false })
      changed.push(item.id)
    }
  })

  return {
    look: named,
    scope,
    changed: changed.length,
    changedItemIds: changed,
    ...(unchanged.length > 0 ? { alreadyWearingIt: unchanged } : {}),
    ...(locked.length > 0
      ? {
          skippedLocked: locked.map((target) => target.item.id),
          warning: `${locked.length} title${locked.length === 1 ? '' : 's'} on locked track${locked.length === 1 ? '' : 's'} (${[...new Set(locked.map((target) => target.track.name))].join(', ')}) kept ${locked.length === 1 ? 'its' : 'their'} old look.`
        }
      : {})
  }
}

export const handlers: Handlers = {
  apply_text_look: (args) => applyTextLookTool(args)
}
