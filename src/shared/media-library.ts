/**
 * The media pool as a person browses it: which kinds there are, how a search matches, how the
 * list sorts, how many clips place each asset, and the facts a card shows about a file.
 *
 * Pure, so the Media panel's filter and sort run under the test suite rather than only in a
 * component. The panel holds the choices; this decides what they mean.
 */

import { allItems, type Asset, type AssetKind, type Project } from './project'
import { hasSteadyBeat } from './beats'
import { captionAssetName } from './captions'
import type { ImportedAsset } from './ipc'

/** What the kind filter offers. `gif` reads as an image and `html` as a composition. */
export type MediaKindGroup = 'video' | 'audio' | 'image' | 'text' | 'composition' | 'brf' | 'font' | 'lut'
export type MediaKindFilter = 'all' | MediaKindGroup
export type MediaSort = 'name' | 'added' | 'duration' | 'kind'

/** Typed as a `Record` so a new asset kind is a build error here rather than a card no filter shows. */
const GROUP_OF: Record<AssetKind, MediaKindGroup> = {
  video: 'video',
  audio: 'audio',
  image: 'image',
  gif: 'image',
  text: 'text',
  html: 'composition',
  brf: 'brf',
  font: 'font',
  lut: 'lut'
}

/** In the order the filter lists them, which is also the order `kind` sorts by. */
export const MEDIA_KIND_GROUPS: readonly { id: MediaKindGroup; label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'image', label: 'Images' },
  { id: 'text', label: 'Text' },
  { id: 'composition', label: 'Compositions' },
  { id: 'brf', label: 'Motion graphics' },
  { id: 'font', label: 'Fonts' },
  { id: 'lut', label: 'Colour LUTs' }
]

export const MEDIA_SORTS: readonly { id: MediaSort; label: string }[] = [
  { id: 'added', label: 'Date added' },
  { id: 'name', label: 'Name' },
  { id: 'duration', label: 'Duration' },
  { id: 'kind', label: 'Kind' }
]

export function kindGroup(kind: AssetKind): MediaKindGroup {
  return GROUP_OF[kind]
}

/** The last segment of a path, on either separator. */
export function fileNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * Whether an asset matches a search. Every word must appear, in any order, in the name, the
 * file's own name (a renamed asset is still found by what the file is called) or a text
 * asset's words. Case and accents are ignored: "cafe" finds "Café".
 */
export function matchesQuery(asset: Asset, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold(
    [asset.name, asset.path ? fileNameOf(asset.path) : '', asset.kind === 'text' ? (asset.text ?? '') : ''].join(' ')
  )
  return words.every((word) => haystack.includes(word))
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function filterAssets(
  assets: readonly Asset[],
  options: { query: string; kind: MediaKindFilter }
): Asset[] {
  return assets.filter(
    (asset) => (options.kind === 'all' || kindGroup(asset.kind) === options.kind) && matchesQuery(asset, options.query)
  )
}

const byName = (a: Asset, b: Asset): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/**
 * Sorted copies, never in place — the project's own order is the import order and must stay so.
 * `added` is newest first (what you just imported is what you are looking for); `duration` is
 * longest first with stills last; `kind` follows the filter's order. Ties fall back to the name
 * and then the id, so two sorts of the same list are always the same list.
 */
export function sortAssets(assets: readonly Asset[], sort: MediaSort): Asset[] {
  const rank = new Map(MEDIA_KIND_GROUPS.map((group, index) => [group.id, index]))
  const compare = (a: Asset, b: Asset): number => {
    switch (sort) {
      case 'name':
        return byName(a, b)
      case 'added':
        return b.createdAt - a.createdAt
      case 'duration':
        return b.durationUs - a.durationUs
      case 'kind':
        return (rank.get(kindGroup(a.kind)) ?? 0) - (rank.get(kindGroup(b.kind)) ?? 0)
    }
  }
  return [...assets].sort((a, b) => compare(a, b) || byName(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** How many items place each asset, across every timeline. An asset no item places is absent. */
export function usageCounts(project: Pick<Project, 'timelines'>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const timeline of project.timelines) {
    for (const item of allItems(timeline)) counts.set(item.assetId, (counts.get(item.assetId) ?? 0) + 1)
  }
  return counts
}

/** Bytes as a person reads them: `812 KB`, `14.2 MB`, `1.3 GB`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** A frame rate as it is usually written: `30 fps`, `29.97 fps`, `23.976 fps`. */
export function formatFps(fps: number): string {
  // Three places, then trailing zeros dropped by the number itself: 29.97002997 → 29.97.
  return `${Math.round(fps * 1000) / 1000} fps`
}

/** "Mono", "Stereo" or "6 ch" — how many channels a sound has, as a card says it. */
export function channelsLabel(channels: number): string {
  return channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels} ch`
}

/**
 * The facts a card or list row shows about an asset, in reading order: size, rate, sound,
 * file size. Duration is drawn separately (on the poster, or in its own column).
 */
export function assetFacts(asset: Asset, bytes?: number | null): string[] {
  const facts: string[] = []
  if (asset.width && asset.height) facts.push(`${asset.width}×${asset.height}`)
  if (asset.fps && asset.kind === 'video') facts.push(formatFps(asset.fps))
  if (asset.kind === 'video') facts.push(asset.hasAudio ? 'with sound' : 'no sound')
  if (asset.kind === 'audio' && asset.channels) facts.push(channelsLabel(asset.channels))
  if (asset.kind === 'font' && asset.font) facts.push(asset.font.family)
  if (asset.beats) facts.push(hasSteadyBeat(asset.beats) ? `${Math.round(asset.beats.bpm)} BPM` : 'No steady beat')
  if (typeof bytes === 'number') facts.push(formatFileSize(bytes))
  return facts
}

/**
 * An import's entries with `reused` meaning what the toast says it means: the asset is already in
 * *this* project. Main's `reused` is its session-wide cache of paths it has probed, so a file
 * imported into project A and then into a fresh project B came back `reused` and B's toast said
 * "Reused 1 already in the project" for a file B had never had. The store's `addAssets` skips an
 * asset whose id the project holds, so the same test decides both what is added and what is said.
 */
export function reusedInProject(imported: readonly ImportedAsset[], assets: readonly Pick<Asset, 'id'>[]): ImportedAsset[] {
  const held = new Set(assets.map((asset) => asset.id))
  return imported.map((entry) => ({ ...entry, reused: held.has(entry.asset.id) }))
}

/**
 * Whether an asset is a caption's line rather than media someone imported: marked by
 * `add_captions`, or — in a project from before the mark — a text asset still carrying the name
 * `add_captions` gave it for its own words.
 */
export function isCaptionAsset(asset: Asset): boolean {
  if (asset.kind !== 'text') return false
  return asset.caption === true || (asset.text !== undefined && asset.name === captionAssetName(asset.text))
}

/**
 * The assets the Media panel shows. Captions are text clips on a Captions track, and every
 * distinct line is its own text asset (that is how `add_captions` lets one edit reword every copy
 * of a line) — so a 3-cue SRT added three "Caption: …" cards and a real subtitle file hundreds,
 * burying the footage. A caption line in use is left out: it is found and edited on its track. An
 * unused one stays, so a caption track deleted by hand leaves nothing invisible behind.
 */
export function mediaPoolAssets(assets: readonly Asset[], uses: ReadonlyMap<string, number>): Asset[] {
  return assets.filter((asset) => !(isCaptionAsset(asset) && (uses.get(asset.id) ?? 0) > 0))
}
