/**
 * Linked clips: a picture and the sound detached from it, kept together.
 *
 * "Detach audio" (every NLE has it) puts a clip's sound on an audio track as an item of its own —
 * same asset, same in and out — and marks the picture `audioDetached`, so the picture plays no
 * sound and the audio item is the only place that sound comes from. The two share a `linkId`, and
 * the operations that would break sync — move, trim, slip, split, delete — act on both unless the
 * caller asks for one alone. Everything that is *about* the sound (volume, fades, duck, J/L offsets,
 * transitions on the audio track) is then the audio item's own, independent of the picture: a
 * picture fade-out no longer fades the sound, which is what the Shinobi rebuild had to duplicate
 * every shot onto hidden tracks to get.
 *
 * **What a link is.** Items sharing a `linkId` that overlap in time. The overlap is part of the
 * definition on purpose: every operation that cuts clips — a split, `remove_range`, a ripple — cuts
 * the picture and its sound at the same frame, and the two halves must come out as two linked
 * pairs, not one group of four. Rather than teach every one of those (and every future one) to mint
 * link ids, `normaliseLinks` runs after each edit and re-derives groups from the overlap: halves
 * that no longer touch in time are separate groups, and an item left alone in its group is simply
 * not linked any more.
 */

import type { Item, Project, Timeline, Track, TransitionKind } from './project'
import { itemEnd, resolveTransition } from './project'

/** Items whose spans overlap. Items that merely abut (a cut between them) do not. */
function overlaps(a: Item, b: Item): boolean {
  return a.from < itemEnd(b) && b.from < itemEnd(a)
}

/** Every item on the timeline, with the id of the track it is on. */
function everyItem(timeline: Timeline): Item[] {
  return timeline.tracks.flatMap((track) => track.items)
}

/** The items linked to `itemId` — not including itself. Empty when it is not linked. */
export function linkedPartners(timeline: Timeline, itemId: string): Item[] {
  const items = everyItem(timeline)
  const item = items.find((candidate) => candidate.id === itemId)
  if (!item?.linkId) return []
  return items.filter((other) => other.id !== item.id && other.linkId === item.linkId)
}

/**
 * `ids` plus every item linked to any of them, in the order given with partners after. What a
 * delete, split or selection acts on by default.
 */
export function withLinked(timeline: Timeline, ids: readonly string[]): string[] {
  const out = [...ids]
  const seen = new Set(ids)
  for (const id of ids) {
    for (const partner of linkedPartners(timeline, id)) {
      if (seen.has(partner.id)) continue
      seen.add(partner.id)
      out.push(partner.id)
    }
  }
  return out
}

/**
 * Re-derives link groups from time overlap, after an edit that may have cut or copied linked
 * items. A no-op on a well-formed timeline — it must be, because `edit()` runs it on every change
 * and compares before and after to decide whether anything happened.
 *
 * - A group whose items fall into separate clusters in time (two halves of a split pair) becomes
 *   one group per cluster; the earliest cluster keeps the original id, the others get `makeId()`.
 * - An item alone in its cluster loses its `linkId`: there is nothing left to keep it in sync with.
 *
 * Returns whether anything changed.
 */
export function normaliseLinks(timeline: Timeline, makeId: () => string): boolean {
  const groups = new Map<string, Item[]>()
  for (const item of everyItem(timeline)) {
    if (item.linkId === undefined) continue
    const group = groups.get(item.linkId)
    if (group) group.push(item)
    else groups.set(item.linkId, [item])
  }
  let changed = false
  for (const group of groups.values()) {
    // Connected components of the overlap graph. Groups are two or three items, so the quadratic
    // walk is nothing.
    const clusters: Item[][] = []
    const placed = new Set<string>()
    const ordered = [...group].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id))
    for (const seed of ordered) {
      if (placed.has(seed.id)) continue
      const cluster = [seed]
      placed.add(seed.id)
      for (let i = 0; i < cluster.length; i += 1) {
        for (const other of ordered) {
          if (placed.has(other.id) || !overlaps(cluster[i]!, other)) continue
          placed.add(other.id)
          cluster.push(other)
        }
      }
      clusters.push(cluster)
    }
    clusters.forEach((cluster, index) => {
      if (cluster.length < 2) {
        for (const item of cluster) delete item.linkId
        changed = true
        return
      }
      if (index === 0) return
      const id = makeId()
      for (const item of cluster) item.linkId = id
      changed = true
    })
  }
  return changed
}

/**
 * True when `audio` plays exactly the sound its linked picture `picture` would have: same asset,
 * same span, same in-point, same speed. Then the preview can take the sound from the element the
 * picture is already decoding instead of opening a second one — the "one decode per clip" case,
 * and the one detach produces. Anything else (the audio slipped, moved or trimmed on its own) plays
 * from an element of its own.
 */
export function soundAlignedWithPicture(audio: Item, picture: Item): boolean {
  return (
    audio.assetId === picture.assetId &&
    audio.from === picture.from &&
    audio.durationInFrames === picture.durationInFrames &&
    audio.sourceStartUs === picture.sourceStartUs &&
    audio.speed === picture.speed
  )
}

// ---------------------------------------------------------------------------
// Detach, reattach, unlink — pure, over a timeline the caller has already cloned
// ---------------------------------------------------------------------------

export interface DetachedPair {
  pictureId: string
  audioId: string
  trackId: string
  linkId: string
}

export interface DetachResult {
  detached: DetachedPair[]
  /** One sentence per item that was not detached, saying why and what to do instead. */
  refused: { itemId: string; reason: string }[]
  /** Things the detach changed that the caller should hear about. */
  warnings: string[]
  /** Audio tracks this call had to create, by id. */
  createdTrackIds: string[]
  /** Transitions copied onto the audio track so a cross-faded cut still cross-fades. */
  addedTransitionIds: string[]
}

export interface DetachOptions {
  /** The audio track to put the sound on. Omitted: the first audio track with room, else a new one. */
  trackId?: string
  makeId(prefix: string): string
  /** A new, empty, named audio track — the caller's factory, so ids and names come from one place. */
  makeAudioTrack(timeline: Timeline): Track
}

function trackOfItem(timeline: Timeline, itemId: string): Track | undefined {
  return timeline.tracks.find((track) => track.items.some((item) => item.id === itemId))
}

function spanText(item: Item): string {
  return `${item.from}-${itemEnd(item)}`
}

/**
 * "Detach audio": each picture's sound becomes a linked item on an audio track — same asset, same
 * in-point, same span and speed — and the picture is marked `audioDetached`. Audibly a no-op when
 * it lands: the audio item takes the picture's volume, fades, J/L offsets and duck (all properties
 * of the *sound*), and where both clips of a picture transition are detached onto one audio track,
 * the transition is copied there so the cut still cross-fades. From then on the two are edited
 * apart: a picture fade-out fades only the picture.
 */
export function detachAudio(
  project: Project,
  timeline: Timeline,
  itemIds: readonly string[],
  options: DetachOptions
): DetachResult {
  const result: DetachResult = {
    detached: [],
    refused: [],
    warnings: [],
    createdTrackIds: [],
    addedTransitionIds: []
  }
  const chosen = options.trackId ? timeline.tracks.find((t) => t.id === options.trackId) : undefined
  if (options.trackId && !chosen) {
    for (const itemId of itemIds) {
      result.refused.push({ itemId, reason: `there is no track ${options.trackId} on this timeline` })
    }
    return result
  }
  if (chosen && chosen.kind !== 'audio') {
    for (const itemId of itemIds) {
      result.refused.push({
        itemId,
        reason: `${chosen.name} is a video track; detached sound goes on an audio track. Omit trackId to let bay pick one`
      })
    }
    return result
  }

  // Picture track id → the audio track this call put that track's sound on.
  const usedFor = new Map<string, string>()
  for (const itemId of itemIds) {
    const track = trackOfItem(timeline, itemId)
    const item = track?.items.find((i) => i.id === itemId)
    if (!track || !item) {
      result.refused.push({ itemId, reason: `there is no item ${itemId} on this timeline` })
      continue
    }
    const asset = project.assets.find((a) => a.id === item.assetId)
    if (track.kind === 'audio') {
      result.refused.push({
        itemId,
        reason: `${itemId} is on audio track ${track.name}, so its sound is already an item of its own`
      })
      continue
    }
    if (!asset || asset.error || !asset.hasVideo || !asset.hasAudio) {
      result.refused.push({
        itemId,
        reason:
          `${itemId} draws ${asset ? `${asset.name}, which has ${asset.hasAudio ? 'no picture' : 'no sound'}` : 'a missing asset'}, ` +
          `so there is no sound to separate from a picture`
      })
      continue
    }
    if (item.audioDetached) {
      const partners = linkedPartners(timeline, itemId).map((p) => p.id)
      result.refused.push({
        itemId,
        reason:
          `${itemId}'s sound is already detached` +
          (partners.length > 0 ? ` — it is ${partners.join(', ')}` : ' (its audio item was unlinked)')
      })
      continue
    }
    if (track.locked) {
      result.refused.push({ itemId, reason: `${track.name} is locked; unlock it to detach ${itemId}'s sound` })
      continue
    }

    let target: Track | undefined = chosen
    if (target) {
      if (target.locked) {
        result.refused.push({
          itemId,
          reason: `${target.name} is locked; unlock it, or omit trackId to let bay pick a free audio track`
        })
        continue
      }
      const clash = target.items.find((other) => overlaps(other, item))
      if (clash) {
        result.refused.push({
          itemId,
          reason:
            `${target.name} has ${clash.id} at ${spanText(clash)}, which overlaps ${itemId} at ${spanText(item)}. ` +
            `Omit trackId to let bay pick a free audio track`
        })
        continue
      }
    } else {
      // Sounds of clips that meet at a cut belong on one track — that is where a copied
      // cross-fade can go — so prefer the track holding the sound of a clip this one shares a
      // transition with, then the track this call already used for the same picture track, then
      // the first free one.
      const free = (t: Track | undefined): t is Track =>
        t !== undefined && t.kind === 'audio' && !t.locked && !t.items.some((other) => overlaps(other, item))
      const neighbours = (timeline.transitions ?? [])
        .filter((t) => t.fromItemId === itemId || t.toItemId === itemId)
        .map((t) => (t.fromItemId === itemId ? t.toItemId : t.fromItemId))
      const neighbourTracks = neighbours.flatMap((id) =>
        linkedPartners(timeline, id)
          .filter((p) => trackOfItem(timeline, p.id)?.kind === 'audio')
          .map((p) => trackOfItem(timeline, p.id))
      )
      target =
        neighbourTracks.find(free) ??
        [usedFor.get(track.id)].map((id) => timeline.tracks.find((t) => t.id === id)).find(free) ??
        timeline.tracks.find(free)
      if (!target) {
        target = options.makeAudioTrack(timeline)
        timeline.tracks.push(target)
        result.createdTrackIds.push(target.id)
      }
    }

    const linkId = item.linkId ?? options.makeId('lnk')
    const audio: Item = {
      id: options.makeId('itm'),
      assetId: item.assetId,
      trackId: target.id,
      from: item.from,
      durationInFrames: item.durationInFrames,
      sourceStartUs: item.sourceStartUs,
      layout: { ...item.layout },
      volume: item.volume,
      fadeInFrames: item.fadeInFrames,
      fadeOutFrames: item.fadeOutFrames,
      speed: item.speed,
      linkId,
      ...(item.audioLeadFrames !== undefined ? { audioLeadFrames: item.audioLeadFrames } : {}),
      ...(item.audioTrailFrames !== undefined ? { audioTrailFrames: item.audioTrailFrames } : {}),
      ...(item.duck ? { duck: { ...item.duck } } : {})
    }
    target.items.push(audio)
    target.items.sort((a, b) => a.from - b.from)
    usedFor.set(track.id, target.id)

    item.linkId = linkId
    item.audioDetached = true
    // The sound's properties went with the sound. Left on the picture they would read back as
    // controls that do nothing.
    delete item.audioLeadFrames
    delete item.audioTrailFrames
    delete item.duck
    result.detached.push({ pictureId: item.id, audioId: audio.id, trackId: target.id, linkId })

    const ducking = timeline.tracks
      .flatMap((t) => t.items)
      .filter((other) => other.duck?.keyTrackId === track.id && other.id !== item.id)
    if (ducking.length > 0) {
      result.warnings.push(
        `${ducking.map((d) => d.id).join(', ')} duck${ducking.length === 1 ? 's' : ''} under ${track.name}, ` +
          `and ${itemId}'s sound is now on ${target.name}, so it no longer ducks them. ` +
          `Set their duck.keyTrackId to ${target.id} if it should`
      )
    }
  }

  copyTransitionsToSound(project, timeline, result, options.makeId)
  return result
}

/**
 * A picture transition carried both clips' sound across its cut. Once both are detached, the
 * sound is two audio items; where they abut on one track, the same transition goes between them
 * (a dip stays a dip, anything else is a cross-fade — a wipe means nothing to sound). Where they
 * do not, the cut is now a hard cut in the sound, and that is said rather than left to be heard.
 */
function copyTransitionsToSound(
  project: Project,
  timeline: Timeline,
  result: DetachResult,
  makeId: (prefix: string) => string
): void {
  const justDetached = new Set(result.detached.map((d) => d.pictureId))
  const soundOf = (pictureId: string): Item | undefined => {
    const picture = everyItem(timeline).find((i) => i.id === pictureId)
    if (!picture?.audioDetached) return undefined
    return linkedPartners(timeline, pictureId).find(
      (p) => p.assetId === picture.assetId && trackOfItem(timeline, p.id)?.kind === 'audio'
    )
  }
  for (const transition of [...(timeline.transitions ?? [])]) {
    if (!justDetached.has(transition.fromItemId) && !justDetached.has(transition.toItemId)) continue
    const from = soundOf(transition.fromItemId)
    const to = soundOf(transition.toItemId)
    const fromTrack = from ? trackOfItem(timeline, from.id) : undefined
    const toTrack = to ? trackOfItem(timeline, to.id) : undefined
    if (from && to && fromTrack && fromTrack === toTrack && itemEnd(from) === to.from) {
      const exists = (timeline.transitions ?? []).some((t) => t.fromItemId === from.id && t.toItemId === to.id)
      if (exists) continue
      const id = makeId('trn')
      const kind: TransitionKind =
        transition.kind === 'dip-to-black' || transition.kind === 'dip-to-white' ? transition.kind : 'cross-dissolve'
      ;(timeline.transitions ??= []).push({
        id,
        kind,
        fromItemId: from.id,
        toItemId: to.id,
        durationInFrames: transition.durationInFrames
      })
      result.addedTransitionIds.push(id)
      continue
    }
    if (!resolveTransition(project, timeline, transition)) continue
    const side = justDetached.has(transition.fromItemId) ? transition.fromItemId : transition.toItemId
    result.warnings.push(
      `the ${transition.kind} between ${transition.fromItemId} and ${transition.toItemId} ` +
        `(${transition.id}) cross-faded ${side}'s sound; with only one side detached onto an audio ` +
        `track the sound now cuts there. Detach the other clip too and the cross-fade is copied onto ` +
        `the audio track`
    )
  }
}

export interface ReattachResult {
  reattached: { pictureId: string; removedAudioIds: string[] }[]
  refused: { itemId: string; reason: string }[]
}

/**
 * The reverse of `detachAudio`: the picture sounds again and its linked audio item goes, handing
 * back the sound's volume, J/L offsets and duck. Given the audio item, it reattaches the picture
 * that item is linked to.
 */
export function reattachAudio(timeline: Timeline, itemIds: readonly string[]): ReattachResult {
  const result: ReattachResult = { reattached: [], refused: [] }
  const done = new Set<string>()
  for (const itemId of itemIds) {
    const given = everyItem(timeline).find((i) => i.id === itemId)
    if (!given) {
      result.refused.push({ itemId, reason: `there is no item ${itemId} on this timeline` })
      continue
    }
    const picture = given.audioDetached ? given : linkedPartners(timeline, itemId).find((p) => p.audioDetached)
    if (!picture) {
      result.refused.push({ itemId, reason: `${itemId} has no detached sound to reattach` })
      continue
    }
    if (done.has(picture.id)) continue
    done.add(picture.id)
    const sounds = linkedPartners(timeline, picture.id).filter(
      (p) => p.assetId === picture.assetId && trackOfItem(timeline, p.id)?.kind === 'audio'
    )
    const locked = [picture, ...sounds].map((i) => trackOfItem(timeline, i.id)).find((t) => t?.locked)
    if (locked) {
      result.refused.push({ itemId, reason: `${locked.name} is locked; unlock it to reattach ${picture.id}'s sound` })
      continue
    }
    const sound = sounds.length === 1 ? sounds[0] : undefined
    if (sound) {
      picture.volume = sound.volume
      if (sound.audioLeadFrames !== undefined) picture.audioLeadFrames = sound.audioLeadFrames
      if (sound.audioTrailFrames !== undefined) picture.audioTrailFrames = sound.audioTrailFrames
      if (sound.duck) picture.duck = { ...sound.duck }
    }
    const removed = new Set(sounds.map((s) => s.id))
    for (const track of timeline.tracks) track.items = track.items.filter((i) => !removed.has(i.id))
    if (timeline.transitions) {
      timeline.transitions = timeline.transitions.filter(
        (t) => !removed.has(t.fromItemId) && !removed.has(t.toItemId)
      )
    }
    delete picture.audioDetached
    if (linkedPartners(timeline, picture.id).length === 0) delete picture.linkId
    result.reattached.push({ pictureId: picture.id, removedAudioIds: [...removed] })
  }
  return result
}

/** Breaks the links of `itemIds` and their partners, so each is edited alone. Returns the ids unlinked. */
export function unlinkItems(timeline: Timeline, itemIds: readonly string[]): string[] {
  const out: string[] = []
  for (const id of withLinked(timeline, itemIds)) {
    const item = everyItem(timeline).find((i) => i.id === id)
    if (!item?.linkId) continue
    delete item.linkId
    out.push(id)
  }
  return out
}
