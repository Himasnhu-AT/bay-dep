/**
 * The timeline's pure geometry: which track is drawn where, where a new track goes, where the
 * gaps are, what a rubber band touches, and how far a fade handle may be pulled. No React and
 * no store, so every rule here is tested under plain Node (`timelineLayout.test.ts`).
 */

import { itemEnd, type Frames, type Item, type Track, type TrackKind } from '@shared/project'

/**
 * Tracks in the order the timeline lists them, top to bottom: video with the topmost *layer*
 * first (V3, V2, V1), then audio in its own order (A1, A2 …).
 *
 * The data order is not wrong and is not changed. The compositor draws video tracks in array
 * order, later on top (`itemsAtFrame`), so the last video track in the array is the one in
 * front — and every NLE shows the one in front at the top of the stack. Audio has no stacking,
 * so it keeps array order, reading downward from the picture. Listing the array as-is put V1
 * above V2 (the reverse of the picture) and, because `addTrack` appends, a new V2 below A1.
 */
export function displayOrder<T extends Pick<Track, 'kind'>>(tracks: readonly T[]): T[] {
  const video = tracks.filter((track) => track.kind === 'video').reverse()
  const audio = tracks.filter((track) => track.kind === 'audio')
  return [...video, ...audio]
}

/**
 * The array index a new track of `anchor`'s kind takes so that it is *displayed* directly above
 * or below `anchor`. Video displays reversed, so "above" is after the anchor in the array; audio
 * displays in array order, so "above" is before it.
 */
export function insertIndexFor(
  tracks: readonly Pick<Track, 'id' | 'kind'>[],
  anchorId: string,
  where: 'above' | 'below'
): number | undefined {
  const index = tracks.findIndex((track) => track.id === anchorId)
  const anchor = tracks[index]
  if (!anchor) return undefined
  const after = anchor.kind === 'video' ? where === 'above' : where === 'below'
  return after ? index + 1 : index
}

/** Track heights in CSS pixels, per viewer. Medium is the height the timeline always had. */
export type TrackSize = 'small' | 'medium' | 'large'

export function trackHeightFor(kind: TrackKind, size: TrackSize = 'medium'): number {
  const medium = kind === 'video' ? 58 : 46
  if (size === 'small') return kind === 'video' ? 36 : 30
  if (size === 'large') return kind === 'video' ? 96 : 76
  return medium
}

// -- gaps ----------------------------------------------------------------------

/** An empty stretch of one track, half-open like every range here: `to` is the next clip's start. */
export interface Gap {
  trackId: string
  from: Frames
  to: Frames
}

/**
 * Every gap on a track *that something follows*: the stretch before the first clip, and each
 * hole between two clips. The runway after the last clip is not a gap — there is nothing there
 * to close up — so it is never offered for selection.
 */
export function gapsOf(track: Pick<Track, 'id' | 'items'>): Gap[] {
  const items = [...track.items].sort((a, b) => a.from - b.from)
  const gaps: Gap[] = []
  let cursor = 0
  for (const item of items) {
    if (item.from > cursor) gaps.push({ trackId: track.id, from: cursor, to: item.from })
    cursor = Math.max(cursor, itemEnd(item))
  }
  return gaps
}

/** The gap containing `frame` on this track, if the frame falls in one. */
export function gapAt(track: Pick<Track, 'id' | 'items'>, frame: number): Gap | undefined {
  return gapsOf(track).find((gap) => frame >= gap.from && frame < gap.to)
}

/**
 * Whether a span is empty on every unlocked track — the condition under which removing it as
 * *time* (`rippleDelete`, which keeps every track in step) closes this gap and takes nothing
 * else with it. Returns the first track that has something there, so a refusal can name it.
 */
export function spanBlockedBy(
  tracks: readonly Pick<Track, 'id' | 'name' | 'locked' | 'items'>[],
  from: Frames,
  to: Frames
): Pick<Track, 'id' | 'name'> | undefined {
  return tracks.find(
    (track) => !track.locked && track.items.some((item) => item.from < to && itemEnd(item) > from)
  )
}

// -- marquee -------------------------------------------------------------------

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** A box from two corners in any order — a rubber band can be dragged up and to the left. */
export function boxFrom(ax: number, ay: number, bx: number, by: number): Box {
  return { left: Math.min(ax, bx), top: Math.min(ay, by), right: Math.max(ax, bx), bottom: Math.max(ay, by) }
}

/**
 * The ids whose rectangles the band touches. Touching is enough, as in every NLE: a band has to
 * reach into a clip, not swallow it whole, or selecting a long clip means scrolling to its end.
 * A band that only meets an edge (zero overlap) touches nothing.
 */
export function marqueeHits(band: Box, rects: readonly (Box & { id: string })[]): string[] {
  return rects
    .filter((rect) => rect.left < band.right && rect.right > band.left && rect.top < band.bottom && rect.bottom > band.top)
    .map((rect) => rect.id)
}

/**
 * The selection a marquee leaves: a plain band replaces it, Shift adds to what was selected when
 * the band started, Cmd toggles each touched clip against it.
 */
export function combineSelection(
  base: readonly string[],
  hits: readonly string[],
  mode: 'replace' | 'add' | 'toggle'
): string[] {
  if (mode === 'replace') return [...hits]
  const out = new Set(base)
  for (const id of hits) {
    if (mode === 'toggle' && base.includes(id)) out.delete(id)
    else out.add(id)
  }
  return [...out]
}

// -- fades and level -----------------------------------------------------------

/**
 * A fade handle dragged to `rawFrames` of fade: whole frames, never negative, and never into the
 * other fade — a fade-in and fade-out that overlap describe a clip that never reaches full level,
 * which nobody dragged for. The same fields the inspector writes, so the handle is that field.
 */
export function clampFade(
  item: Pick<Item, 'durationInFrames' | 'fadeInFrames' | 'fadeOutFrames'>,
  edge: 'in' | 'out',
  rawFrames: number
): Frames {
  const other = edge === 'in' ? item.fadeOutFrames : item.fadeInFrames
  const room = Math.max(0, item.durationInFrames - Math.max(0, other))
  if (!Number.isFinite(rawFrames)) return edge === 'in' ? item.fadeInFrames : item.fadeOutFrames
  return Math.max(0, Math.min(room, Math.round(rawFrames)))
}

/** The inspector's volume range: 0 is silence, 1 unity, 2 is +6 dB. */
export const VOLUME_MAX = 2

/** A volume line at `y` px from the top of a clip `height` px tall, as a volume in 0..VOLUME_MAX. */
export function volumeAtY(y: number, height: number): number {
  if (!(height > 0)) return 1
  const ratio = 1 - Math.min(1, Math.max(0, y / height))
  return Math.round(ratio * VOLUME_MAX * 100) / 100
}

export function yForVolume(volume: number, height: number): number {
  const v = Number.isFinite(volume) ? Math.min(VOLUME_MAX, Math.max(0, volume)) : 1
  return (1 - v / VOLUME_MAX) * height
}

/** "−6.0 dB", "0.0 dB", "+3.5 dB", "−∞ dB": a level as editors read it. */
export function formatDb(volume: number): string {
  if (!(volume > 0)) return '−∞ dB'
  const db = 20 * Math.log10(volume)
  const rounded = Math.round(db * 10) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`
}

/** "+12f" / "−3f" / "0f": a signed frame delta, with a real minus sign. */
export function formatDelta(frames: number): string {
  if (frames === 0) return '0f'
  return `${frames > 0 ? '+' : '−'}${Math.abs(frames)}f`
}
