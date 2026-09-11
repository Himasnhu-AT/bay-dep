/**
 * The tools that change the project.
 *
 * Everything here goes through the existing store actions, and each tool is wrapped in one
 * `transact` so that **one tool call is one undo step**. That is not tidiness: `undo` is
 * itself a tool, and its description promises it reverses exactly what the agent last did.
 * An `edit_item` that moved a clip and changed its volume as two entries would leave `undo`
 * putting the volume back and the clip where the agent dragged it — a half-reverted project
 * neither the user nor the agent asked for.
 *
 * The store's mutators refuse silently: `moveItem` returns without moving when the
 * destination is locked or occupied, and `patchItem` does nothing on a locked track. A
 * silent refusal reaching an agent as a successful call is the failure shape this codebase
 * keeps rediscovering, so every tool here checks the conditions *first* and fails with the
 * reason and the way out.
 */

import {
  allItems,
  itemEnd,
  timelineDuration,
  type Item,
  type Layout,
  type TrackKind
} from '@shared/project'
import { resolveId } from '@shared/mcp'
import { bay } from '@/lib/bay'
import {
  assertNoCollision,
  assertUnlocked,
  fail,
  project,
  resolveAsset,
  resolveItem,
  resolveTrack,
  store,
  timeline,
  usToFramesAtTimeline
} from './helpers'
import { frameOrPlayhead, itemsCrossing } from './read'

export async function importMedia(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const paths = args.paths as string[]
  if (paths.length === 0) fail('No paths were given, so there is nothing to import.')
  const relative = paths.filter((p) => !p.startsWith('/'))
  if (relative.length > 0) {
    fail(
      `These paths are not absolute: ${relative.join(', ')}. bay resolves nothing relative to a ` +
        `working directory, because it has no relationship to yours — pass full paths.`
    )
  }

  const api = bay()
  if (!api) fail('This window has no bridge to the app, so media cannot be imported.')

  let imported
  try {
    imported = await api.media.importPaths(paths)
  } catch (error) {
    fail(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  store().addAssets(imported.map((entry) => entry.asset))
  return {
    assets: imported.map((entry) => ({
      id: entry.asset.id,
      name: entry.asset.name,
      kind: entry.asset.kind,
      path: entry.asset.path,
      durationInFrames: usToFramesAtTimeline(entry.asset.durationUs),
      hasAudio: entry.asset.hasAudio,
      hasVideo: entry.asset.hasVideo,
      reused: entry.reused,
      ...(entry.asset.error
        ? { error: entry.asset.error, placeable: false }
        : { placeable: true })
    })),
    // Said explicitly because the catalog warns about it and an agent that retries a
    // corrupt file burns a turn discovering the same thing.
    unreadable: imported.filter((e) => e.asset.error).length
  }
}

export function placeAsset(args: Record<string, unknown>): Record<string, unknown> {
  const asset = resolveAsset(String(args.assetId))
  if (asset.error) {
    fail(
      `Asset ${asset.name} could not be read (${asset.error}), so it cannot be placed. ` +
        `Re-importing will not help — the file itself is the problem.`
    )
  }

  const tl = timeline()
  const atFrame = args.atFrame === undefined ? store().playhead : Number(args.atFrame)
  const wantedKind: TrackKind =
    asset.hasVideo || asset.kind === 'image' || asset.kind === 'text' ? 'video' : 'audio'

  let trackId: string | undefined
  if (args.trackId !== undefined) {
    const track = resolveTrack(String(args.trackId))
    if (track.kind !== wantedKind) {
      fail(
        `${asset.name} needs a ${wantedKind} track but ${track.name} is ${track.kind}. ` +
          `Omit trackId to let bay pick one, or add_track with kind "${wantedKind}".`
      )
    }
    assertUnlocked(track, `placing ${asset.name}`)
    const duration = Math.max(
      1,
      asset.durationUs > 0 ? usToFramesAtTimeline(asset.durationUs) : tl.fps * 5
    )
    assertNoCollision(track, { id: '', from: atFrame, durationInFrames: duration })
    trackId = track.id
  }

  let placed: string | null = null
  store().transact(() => {
    placed = store().placeAsset(asset.id, atFrame, trackId)
  })
  if (!placed) fail(`${asset.name} could not be placed at frame ${atFrame}.`)

  const { item, track } = resolveItem(placed)
  return {
    itemId: item.id,
    trackId: track.id,
    trackName: track.name,
    from: item.from,
    durationInFrames: item.durationInFrames,
    endFrame: itemEnd(item)
  }
}

export function editItem(args: Record<string, unknown>): Record<string, unknown> {
  const { item, track } = resolveItem(String(args.itemId))
  assertUnlocked(track, `editing ${item.id}`)

  const destination = args.trackId === undefined ? track : resolveTrack(String(args.trackId))
  if (destination.id !== track.id) {
    if (destination.kind !== track.kind) {
      fail(
        `Item ${item.id} is on a ${track.kind} track and ${destination.name} is ` +
          `${destination.kind}. An item cannot change kind; place a different asset instead.`
      )
    }
    assertUnlocked(destination, `moving ${item.id} onto ${destination.name}`)
  }

  const from = args.from === undefined ? item.from : Math.max(0, Math.round(Number(args.from)))
  const durationInFrames =
    args.durationInFrames === undefined
      ? item.durationInFrames
      : Math.max(1, Math.round(Number(args.durationInFrames)))

  const timingChanged =
    from !== item.from || durationInFrames !== item.durationInFrames || destination.id !== track.id
  if (timingChanged) {
    assertNoCollision(destination, { id: item.id, from, durationInFrames })
  }

  const layout: Layout = { ...item.layout }
  for (const key of ['left', 'top', 'width', 'height', 'opacity', 'rotation'] as const) {
    if (args[key] !== undefined) layout[key] = Number(args[key])
  }
  if (layout.width < 1 || layout.height < 1) {
    fail(`width and height must be at least 1 pixel; got ${layout.width}x${layout.height}.`)
  }

  const patch: Partial<Omit<Item, 'id' | 'trackId'>> = { from, durationInFrames, layout }
  if (args.volume !== undefined) patch.volume = Number(args.volume)
  if (args.speed !== undefined) {
    const speed = Number(args.speed)
    if (speed <= 0) fail(`speed must be greater than 0; got ${speed}.`)
    patch.speed = speed
  }
  if (args.fadeInFrames !== undefined) patch.fadeInFrames = Math.round(Number(args.fadeInFrames))
  if (args.fadeOutFrames !== undefined) patch.fadeOutFrames = Math.round(Number(args.fadeOutFrames))

  const fadeIn = patch.fadeInFrames ?? item.fadeInFrames
  const fadeOut = patch.fadeOutFrames ?? item.fadeOutFrames
  if (fadeIn + fadeOut > durationInFrames) {
    fail(
      `fadeInFrames ${fadeIn} + fadeOutFrames ${fadeOut} is longer than the clip ` +
        `(${durationInFrames} frames). Shorten the fades or lengthen the clip.`
    )
  }

  store().transact(() => {
    // The track change has to go through `moveItem` — `patchItem` deliberately omits
    // `trackId` — and everything else rides in one `patchItem`, `layout` included, because
    // layout is a field of Item. Inside one transaction that is still a single undo step.
    if (destination.id !== track.id) store().moveItem(item.id, from, destination.id)
    store().patchItem(item.id, patch)
  })

  const after = resolveItem(item.id)
  return {
    itemId: after.item.id,
    trackId: after.track.id,
    from: after.item.from,
    durationInFrames: after.item.durationInFrames,
    endFrame: itemEnd(after.item),
    layout: { ...after.item.layout },
    volume: after.item.volume,
    speed: after.item.speed,
    fadeInFrames: after.item.fadeInFrames,
    fadeOutFrames: after.item.fadeOutFrames
  }
}

export function splitAt(args: Record<string, unknown>): Record<string, unknown> {
  const frame = frameOrPlayhead(args)
  const tl = timeline()

  let targets: Item[]
  if (args.itemIds === undefined) {
    targets = itemsCrossing(frame)
    if (targets.length === 0) {
      const nearest = allItems(tl)
        .map((i) => ({ id: i.id, from: i.from, end: itemEnd(i) }))
        .sort((a, b) => Math.abs(a.from - frame) - Math.abs(b.from - frame))
        .slice(0, 3)
      fail(
        `Nothing crosses frame ${frame}, so there is nothing to cut — a cut on an item's edge ` +
          `would make a zero-length clip. ` +
          (nearest.length > 0
            ? `Nearest items: ${nearest.map((n) => `${n.id} (${n.from}-${n.end})`).join(', ')}.`
            : 'The timeline is empty.')
      )
    }
  } else {
    const ids = args.itemIds as string[]
    const known = allItems(tl).map((i) => i.id)
    targets = ids.map((given) => {
      const resolved = resolveId(given, known)
      if (!resolved.ok) fail(resolved.error)
      // Same as in `resolveItem`: narrowing for the compiler, not a reachable branch.
      const found = allItems(tl).find((i) => i.id === resolved.id)
      if (!found) fail(`No item ${resolved.id} on the active timeline.`)
      return found
    })
    const uncut = targets.filter((i) => frame <= i.from || frame >= itemEnd(i))
    if (uncut.length > 0) {
      fail(
        `Frame ${frame} is not inside ${uncut.map((i) => `${i.id} (${i.from}-${itemEnd(i)})`).join(', ')}. ` +
          `A cut on or outside an item's edge would make a zero-length clip.`
      )
    }
  }

  const locked = targets.filter((i) => tl.tracks.find((t) => t.id === i.trackId)?.locked)
  if (locked.length > 0) {
    fail(
      `${locked.map((i) => i.id).join(', ')} ${locked.length === 1 ? 'is' : 'are'} on a locked ` +
        `track, so the cut is refused. Unlock it in the UI first.`
    )
  }

  const before = allItems(tl).length
  store().transact(() => {
    store().select(targets.map((i) => i.id))
    store().splitAt(frame)
  })
  const created = allItems(timeline()).length - before
  if (created === 0) fail(`Frame ${frame} produced no cut. Nothing on the timeline changed.`)

  return {
    frame,
    itemsCut: targets.length,
    newItems: store().selection,
    note: `${targets.length} item${targets.length === 1 ? '' : 's'} cut at frame ${frame}.`
  }
}

export function deleteItems(args: Record<string, unknown>): Record<string, unknown> {
  const tl = timeline()
  const known = allItems(tl).map((i) => i.id)
  const ids = (args.itemIds as string[]).map((given) => {
    const resolved = resolveId(given, known)
    if (!resolved.ok) fail(resolved.error)
    return resolved.id
  })
  if (ids.length === 0) fail('No itemIds were given, so there is nothing to delete.')

  const doomed = allItems(tl).filter((i) => ids.includes(i.id))
  const lockedTracks = tl.tracks.filter(
    (t) => t.locked && doomed.some((i) => i.trackId === t.id)
  )
  if (lockedTracks.length > 0) {
    fail(
      `${lockedTracks.map((t) => t.name).join(', ')} ${lockedTracks.length === 1 ? 'is' : 'are'} ` +
        `locked, so nothing was deleted. Unlock in the UI, or delete only items on free tracks.`
    )
  }

  const ripple = args.ripple === true
  // Computed before the delete, because after it the items are gone and the shift cannot be
  // derived. Each survivor moves back by the total length of everything removed that ended
  // at or before it, which closes exactly the gaps this call made and no pre-existing ones.
  const shifts: { id: string; to: number }[] = []
  if (ripple) {
    for (const track of tl.tracks) {
      const removed = track.items.filter((i) => ids.includes(i.id))
      if (removed.length === 0) continue
      for (const survivor of track.items) {
        if (ids.includes(survivor.id)) continue
        const shift = removed
          .filter((r) => itemEnd(r) <= survivor.from)
          .reduce((total, r) => total + r.durationInFrames, 0)
        if (shift > 0) shifts.push({ id: survivor.id, to: survivor.from - shift })
      }
    }
    shifts.sort((a, b) => a.to - b.to)
  }

  store().transact(() => {
    store().select(ids)
    store().deleteSelected()
    for (const shift of shifts) store().moveItem(shift.id, shift.to)
  })

  return {
    deleted: ids,
    rippled: ripple ? shifts.length : 0,
    durationInFrames: timelineDuration(timeline()),
    ...(ripple && shifts.length > 0
      ? {
          note:
            'Ripple moved items on the affected tracks only. Anything layered on other ' +
            'tracks is now out of sync unless you move it too.'
        }
      : {})
  }
}

export function addTrack(args: Record<string, unknown>): Record<string, unknown> {
  const kind = String(args.kind) as TrackKind
  let id = ''
  store().transact(() => {
    id = store().addTrack(kind)
  })
  const track = timeline().tracks.find((t) => t.id === id)
  if (!track) fail('The track was not created.')
  const sameKind = timeline().tracks.filter((t) => t.kind === kind)
  return {
    trackId: track.id,
    name: track.name,
    kind: track.kind,
    ...(kind === 'video'
      ? {
          note:
            `${track.name} is the topmost video track, so items on it draw over the ` +
            `${sameKind.length - 1} below.`
        }
      : {})
  }
}

export function setPlayhead(args: Record<string, unknown>): Record<string, unknown> {
  const wanted = Math.max(0, Math.round(Number(args.frame)))
  store().setPlayhead(wanted)
  const actual = store().playhead
  const duration = timelineDuration(timeline())
  return {
    playhead: actual,
    // The store clamps to the timeline's end. Reporting the request back unchanged would
    // have the agent believe it is somewhere it is not.
    ...(actual !== wanted
      ? { requested: wanted, clampedTo: actual, timelineDurationInFrames: duration }
      : {})
  }
}

export function undo(): Record<string, unknown> {
  const state = store()
  if (state.past.length === 0) {
    fail('There is nothing to undo — no change has been made to this project yet.')
  }
  const before = timelineDuration(timeline())
  const itemsBefore = allItems(timeline()).length
  state.undo()
  const after = timeline()
  return {
    undone: true,
    remainingUndoSteps: store().past.length,
    timeline: {
      durationInFrames: timelineDuration(after),
      itemCount: allItems(after).length
    },
    changed: { durationWas: before, itemCountWas: itemsBefore }
  }
}

/** Exposed for the dispatcher's benefit so it can report what a project currently holds. */
export function projectSummary(): string {
  const tl = timeline()
  return `${project().name}: ${allItems(tl).length} items across ${tl.tracks.length} tracks`
}
