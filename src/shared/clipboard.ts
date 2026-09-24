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
    const candidates = [
      ...(preferred ? [preferred] : []),
      ...timeline.tracks.filter((t) => t.kind === source.kind && t !== preferred)
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
// Paste attributes
// ---------------------------------------------------------------------------

/** What Paste Attributes can carry from the copied clip to the selected ones. */
export const PASTE_ATTRIBUTES = [
  { id: 'transform', label: 'Transform', detail: 'Position, size, rotation, opacity, crop and their keyframes' },
  { id: 'grade', label: 'Colour grade', detail: 'Wheels, curves, LUT, halation, vignette, grain' },
  { id: 'adjustments', label: 'Adjustments', detail: 'Brightness, contrast, saturation, blur, blend mode' },
  { id: 'volume', label: 'Volume', detail: 'Level, fades, ducking and volume keyframes' },
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
  if (attributes.has('volume')) {
    patch.volume = source.volume
    patch.fadeInFrames = Math.min(source.fadeInFrames, target.durationInFrames)
    patch.fadeOutFrames = Math.min(source.fadeOutFrames, target.durationInFrames)
    patch.duck = source.duck ? copy(source.duck) : undefined
    takeKeys(['volume'])
  }
  if (attributes.has('speed')) patch.speed = source.speed
  if (keysTouched) patch.keyframes = Object.keys(keyframes).length > 0 ? keyframes : undefined
  return patch
}
