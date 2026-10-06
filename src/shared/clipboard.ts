/**
 * Clips on the clipboard: what Copy takes, where Paste puts it, and Paste Attributes.
 *
 * The clipboard is bay's own, not the system's — a clip is a reference to an asset in a project,
 * and nothing outside bay could read one. It carries the assets the clips use, so a paste into
 * another project brings its media with it instead of placing clips that point at nothing.
 *
 * Paste keeps the clips' timing relative to each other: the earliest lands on the playhead and the
 * rest keep their distance from it. Each clip goes back on the track it came from, unless that
 * track is locked, gone, or occupied there — then the whole group from that track moves to the
 * next track of its kind with room, or onto a new one. A paste never overwrites anything.
 */

import {
  findAsset,
  itemsOverlap,
  type Asset,
  type Frames,
  type Item,
  type Project,
  type Timeline,
  type Track,
  type TrackKind,
  type Transition
} from './project'

export interface ClipboardPayload {
  /** Deep copies, positions as they were when copied. */
  items: Item[]
  /** The assets those items place, so a paste elsewhere can add any the project lacks. */
  assets: Asset[]
  /** Transitions whose two clips were both copied. */
  transitions: Transition[]
  /** The tracks the items came from, in timeline order. */
  tracks: { id: string; kind: TrackKind; name: string }[]
  /** The earliest copied frame; it lands on the paste frame. */
  anchor: Frames
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A copy of these clips, or null when none of the ids is on the timeline. */
export function copyClips(project: Project, timeline: Timeline, itemIds: readonly string[]): ClipboardPayload | null {
  const ids = new Set(itemIds)
  const items: Item[] = []
  const tracks: ClipboardPayload['tracks'] = []
  for (const track of timeline.tracks) {
    const picked = track.items.filter((item) => ids.has(item.id))
    if (picked.length === 0) continue
    tracks.push({ id: track.id, kind: track.kind, name: track.name })
    items.push(...picked.map(copy))
  }
  if (items.length === 0) return null
  const assetIds = new Set(items.map((item) => item.assetId))
  const assets = project.assets.filter((asset) => assetIds.has(asset.id)).map(copy)
  const transitions = (timeline.transitions ?? [])
    .filter((t) => ids.has(t.fromItemId) && ids.has(t.toItemId))
    .map(copy)
  return { items, assets, transitions, tracks, anchor: Math.min(...items.map((item) => item.from)) }
}

export interface PasteOptions {
  /** Paste a single-track copy onto this track instead of the one it came from. */
  trackId?: string
  makeId(prefix: string): string
  /** A new empty track of `kind`, named; the paste pushes it onto the timeline. */
  makeTrack(timeline: Timeline, kind: TrackKind): Track
}

export type PasteResult =
  | { ok: true; itemIds: string[]; createdTrackIds: string[]; addedAssetIds: string[] }
  | { ok: false; error: string }

function fits(track: Track, items: readonly Item[]): boolean {
  if (track.locked) return false
  return items.every((item) => !track.items.some((other) => itemsOverlap(other, item)))
}

/**
 * Pastes `payload` with its earliest clip at `at`. Mutates `project` and `timeline` (the store
 * runs it inside `edit()`); returns the new clips' ids. New link ids are minted per copied
 * group, so a pasted picture and sound are linked to each other and never to the originals.
 */
export function pasteClips(
  project: Project,
  timeline: Timeline,
  payload: ClipboardPayload,
  at: Frames,
  options: PasteOptions
): PasteResult {
  if (payload.items.length === 0) return { ok: false, error: 'The clipboard is empty. Copy a clip first.' }
  const offset = Math.max(0, Math.round(at)) - payload.anchor

  const addedAssetIds: string[] = []
  for (const asset of payload.assets) {
    if (findAsset(project, asset.id)) continue
    project.assets.push(copy(asset))
    addedAssetIds.push(asset.id)
  }

  const idMap = new Map<string, string>()
  const linkMap = new Map<string, string>()
  const target = options.trackId ? timeline.tracks.find((t) => t.id === options.trackId) : undefined
  const createdTrackIds: string[] = []
  const claimed = new Set<string>()
  const itemIds: string[] = []

  for (const source of payload.tracks) {
    const group: Item[] = payload.items
      .filter((item) => item.trackId === source.id)
      .map((item) => {
        const id = options.makeId('itm')
        idMap.set(item.id, id)
        const next: Item = { ...copy(item), id, from: item.from + offset }
        if (item.linkId) {
          const link = linkMap.get(item.linkId) ?? options.makeId('lnk')
          linkMap.set(item.linkId, link)
          next.linkId = link
        }
        return next
      })

    const preferred =
      target && payload.tracks.length === 1 && target.kind === source.kind
        ? target
        : timeline.tracks.find((t) => t.id === source.id && t.kind === source.kind)
    // The nearest track of the kind with room: the copy stays close to where it was asked for.
    const home = timeline.tracks.findIndex((t) => t === preferred || t.id === source.id)
    const distance = (t: Track): number => (home < 0 ? 0 : Math.abs(timeline.tracks.indexOf(t) - home))
    const candidates = [
      ...(preferred ? [preferred] : []),
      ...timeline.tracks
        .filter((t) => t.kind === source.kind && t !== preferred)
        .sort((a, b) => distance(a) - distance(b))
    ].filter((t) => !claimed.has(t.id))
    let destination = candidates.find((t) => fits(t, group))
    if (!destination) {
      destination = options.makeTrack(timeline, source.kind)
      timeline.tracks.push(destination)
      createdTrackIds.push(destination.id)
    }
    claimed.add(destination.id)
    for (const item of group) {
      item.trackId = destination.id
      destination.items.push(item)
      itemIds.push(item.id)
    }
    destination.items.sort((a, b) => a.from - b.from)
  }

  for (const transition of payload.transitions) {
    const fromItemId = idMap.get(transition.fromItemId)
    const toItemId = idMap.get(transition.toItemId)
    if (!fromItemId || !toItemId) continue
    ;(timeline.transitions ??= []).push({ ...copy(transition), id: options.makeId('trn'), fromItemId, toItemId })
  }

  return { ok: true, itemIds, createdTrackIds, addedAssetIds }
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

export type DuplicateResult =
  | (Extract<PasteResult, { ok: true }> & { at: Frames; sourceTrackIds: string[] })
  | { ok: false; error: string }

/**
 * Duplicate (⌘D): a copy of the clips straight after them — the group shifted by its own span, so
 * one clip lands on its own end and several keep their spacing. It is Paste at the selection's
 * end, so it lands where Paste would: on the clips' own tracks when there is room, else on the
 * nearest track of the kind with room, else on a new one. It used to skip any clip whose next
 * slot was taken, silently, so ⌘D on a clip with another after it did nothing at all.
 */
export function duplicateClips(
  project: Project,
  timeline: Timeline,
  itemIds: readonly string[],
  options: Omit<PasteOptions, 'trackId'>
): DuplicateResult {
  const unlocked = timeline.tracks
    .filter((track) => !track.locked)
    .flatMap((track) => track.items)
    .filter((item) => itemIds.includes(item.id))
    .map((item) => item.id)
  if (unlocked.length === 0) {
    const locked = timeline.tracks.find((t) => t.locked && t.items.some((i) => itemIds.includes(i.id)))
    return {
      ok: false,
      error: locked
        ? `${locked.name} is locked — unlock it in the track header to duplicate its clips.`
        : 'Select the clips to duplicate first.'
    }
  }
  const payload = copyClips(project, timeline, unlocked)
  if (!payload) return { ok: false, error: 'Select the clips to duplicate first.' }
  const at = Math.max(...payload.items.map((item) => item.from + item.durationInFrames))
  const result = pasteClips(project, timeline, payload, at, options)
  if (!result.ok) return result
  return { ...result, at, sourceTrackIds: payload.tracks.map((t) => t.id) }
}

/**
 * Where a duplicate went, as one sentence: "Duplicated to 00:00:11:00 on V1." — or, when the
 * clips' own track had no room, which track took them instead and why.
 */
export function describeDuplicate(
  timeline: Timeline,
  result: Extract<DuplicateResult, { ok: true }>,
  formatFrame: (frame: Frames) => string
): string {
  const name = (id: string): string => timeline.tracks.find((t) => t.id === id)?.name ?? id
  const landed = [
    ...new Set(
      result.itemIds
        .map((id) => timeline.tracks.find((t) => t.items.some((i) => i.id === id))?.id)
        .filter((id): id is string => id !== undefined)
    )
  ]
  const count = result.itemIds.length
  const what = count === 1 ? 'the clip' : `${count} clips`
  const moved = landed.filter((id) => !result.sourceTrackIds.includes(id))
  const where = `at ${formatFrame(result.at)} on ${landed.map(name).join(', ')}`
  if (moved.length === 0) return `Duplicated ${what} ${where}.`
  const from = result.sourceTrackIds.map(name).join(', ')
  const created = moved.filter((id) => result.createdTrackIds.includes(id))
  return (
    `${from} had no room after ${count === 1 ? 'it' : 'them'}, so the copy went ${where}` +
    (created.length > 0 ? ` (a new track).` : '.')
  )
}

// ---------------------------------------------------------------------------
// Paste attributes
// ---------------------------------------------------------------------------

/** What Paste Attributes can carry from the copied clip to the selected ones. */
export const PASTE_ATTRIBUTES = [
  { id: 'transform', label: 'Transform', detail: 'Position, size, rotation, opacity, crop and their keyframes' },
  { id: 'grade', label: 'Colour grade', detail: 'Wheels, curves, LUT, halation, vignette, grain' },
  { id: 'adjustments', label: 'Adjustments', detail: 'Brightness, contrast, saturation, blur, blend mode' },
  { id: 'effects', label: 'Video effects', detail: 'The effect stack, in its order' },
  { id: 'volume', label: 'Volume', detail: 'Level, pan, fades, ducking and volume keyframes' },
  { id: 'speed', label: 'Speed', detail: 'Playback rate' }
] as const

export type PasteAttribute = (typeof PASTE_ATTRIBUTES)[number]['id']

const TRANSFORM_KEYS = ['opacity', 'left', 'top', 'width', 'height', 'rotation', 'scale'] as const

/**
 * The fields to set on `target` so it takes `attributes` from `source`, as one patch. A field the
 * source does not have (no grade) is *removed* from the target — pasting "no grade" is a paste.
 * Keys that are not being pasted stay the target's own, so pasting a transform keeps its volume
 * keyframes.
 */
export function attributePatch(
  source: Item,
  target: Item,
  attributes: ReadonlySet<PasteAttribute>
): Partial<Item> {
  const patch: Partial<Item> = {}
  const keyframes = { ...(target.keyframes ?? {}) }
  let keysTouched = false
  const takeKeys = (properties: readonly string[]): void => {
    for (const property of properties) {
      const list = source.keyframes?.[property as keyof typeof keyframes]
      if (list && list.length > 0) keyframes[property as keyof typeof keyframes] = copy(list)
      else delete keyframes[property as keyof typeof keyframes]
    }
    keysTouched = true
  }
  if (attributes.has('transform')) {
    patch.layout = copy(source.layout)
    patch.crop = source.crop ? copy(source.crop) : undefined
    takeKeys(TRANSFORM_KEYS)
  }
  if (attributes.has('grade')) patch.grade = source.grade ? copy(source.grade) : undefined
  if (attributes.has('adjustments')) {
    patch.adjustments = source.adjustments ? copy(source.adjustments) : undefined
    patch.blendMode = source.blendMode
  }
  if (attributes.has('effects')) patch.effects = source.effects ? copy(source.effects) : undefined
  if (attributes.has('volume')) {
    patch.volume = source.volume
    patch.fadeInFrames = Math.min(source.fadeInFrames, target.durationInFrames)
    patch.fadeOutFrames = Math.min(source.fadeOutFrames, target.durationInFrames)
    patch.duck = source.duck ? copy(source.duck) : undefined
    patch.pan = source.pan
    takeKeys(['volume'])
  }
  if (attributes.has('speed')) patch.speed = source.speed
  if (keysTouched) patch.keyframes = Object.keys(keyframes).length > 0 ? keyframes : undefined
  return patch
}
