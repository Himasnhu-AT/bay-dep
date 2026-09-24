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

// -- trimming ---------------------------------------------------------------------

/**
 * Where a dragged trim edge is, in (fractional) frames: where it was when grabbed plus the
 * pointer's travel. Not the frame under the pointer — the handle is 8px wide, so a grab inside
 * it put the edge under the pointer on the first move, a jump of up to 8px (about 20 frames at
 * 0.4 px/frame) before the hand had moved at all. Snapping and rounding happen after this.
 */
export function trimEdgeFrame(edgeAtGrab: number, dxPx: number, pixelsPerFrame: number): number {
  if (!(pixelsPerFrame > 0)) return edgeAtGrab
  return edgeAtGrab + dxPx / pixelsPerFrame
}

// -- hit zones at a cut ----------------------------------------------------------

/** A clip sits this many px inside its lane, top and bottom (`Clip.tsx`: `top: 4`, `height - 8`). */
export const CLIP_INSET = 4
/** A trim handle's hit width at each end of a clip (`Clip.tsx`'s `w-2`). */
export const TRIM_HANDLE_WIDTH = 8
/** A fade corner: this big (`size-2.5`), centred this far in from its end, on the clip's top edge. */
export const FADE_CORNER_SIZE = 10
export const FADE_CORNER_INSET = 8
/** The cut target's width: it may cover part of each trim handle, never all of it. */
export const JUNCTION_TARGET_WIDTH = 12

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the button on a cut sits, in lane coordinates: a short pill in the middle of the lane,
 * below the fade corners.
 *
 * It was a full-height, 16px-wide zone over the cut, stacked above the clips — so at every butt
 * cut it covered both trim handles and the outgoing clip's fade-out corner, and trimming,
 * rolling or fading at a cut could not be done with the mouse at all. The handles now keep the
 * top and bottom of the lane; the cut keeps its middle, which is also where a stored
 * transition's band is drawn.
 */
export function junctionTarget(cutX: number, laneHeight: number): Rect {
  const inner = Math.max(0, laneHeight - 2 * CLIP_INSET)
  const height = Math.max(8, Math.min(16, Math.floor(inner / 3)))
  const centredTop = CLIP_INSET + (inner - height) / 2
  const top = Math.max(CLIP_INSET + FADE_CORNER_SIZE, centredTop)
  return { left: cutX - JUNCTION_TARGET_WIDTH / 2, top, width: JUNCTION_TARGET_WIDTH, height }
}

export type LaneHit =
  | { kind: 'junction'; cutX: number }
  | { kind: 'fade-in' | 'fade-out' | 'trim-start' | 'trim-end' | 'body'; clip: number }

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height
}

/**
 * What a press at (x, y) in a lane lands on, in the timeline's stacking order: the cut target
 * (z-20) over the fade corners (z-2) over the trim handles over the clip body. `clips` are
 * `{ left, width }` in lane px with their fade lengths in px (a fade corner rides its wedge).
 */
export function laneHitAt(
  x: number,
  y: number,
  laneHeight: number,
  clips: readonly { left: number; width: number; fadeIn?: number; fadeOut?: number }[],
  cuts: readonly number[]
): LaneHit | null {
  for (const cutX of cuts) {
    if (inside(junctionTarget(cutX, laneHeight), x, y)) return { kind: 'junction', cutX }
  }
  const corner = (cx: number): Rect => ({
    left: cx - FADE_CORNER_SIZE / 2,
    top: CLIP_INSET,
    width: FADE_CORNER_SIZE,
    height: FADE_CORNER_SIZE
  })
  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i]
    if (!clip || clip.width < 24) continue
    const inX = clip.left + Math.max(FADE_CORNER_INSET, clip.fadeIn ?? 0)
    const outX = clip.left + Math.min(clip.width - FADE_CORNER_INSET, clip.width - (clip.fadeOut ?? 0))
    if (inside(corner(outX), x, y)) return { kind: 'fade-out', clip: i }
    if (inside(corner(inX), x, y)) return { kind: 'fade-in', clip: i }
  }
  for (let i = clips.length - 1; i >= 0; i--) {
    const clip = clips[i]
    if (!clip) continue
    const body: Rect = { left: clip.left, top: CLIP_INSET, width: clip.width, height: laneHeight - 2 * CLIP_INSET }
    if (!inside(body, x, y)) continue
    if (x >= clip.left + clip.width - TRIM_HANDLE_WIDTH) return { kind: 'trim-end', clip: i }
    if (x < clip.left + TRIM_HANDLE_WIDTH) return { kind: 'trim-start', clip: i }
    return { kind: 'body', clip: i }
  }
  return null
}

/**
 * How far a drag near an edge scrolls the timeline, in pixels: 24 toward the edge the pointer is
 * *moving toward*, and nothing otherwise. Scrolling on any move near an edge fought a drag that
 * started there: at zoom-to-fit the last clip ends ~24px from the right edge, so pulling its end
 * handle left scrolled the view right and trimmed 1 frame for a 10-frame drag.
 */
export function autoScrollDelta(
  clientX: number,
  previousX: number | null,
  bounds: { left: number; right: number },
  margin = 48
): number {
  if (previousX === null) return 0
  if (clientX > bounds.right - margin && clientX > previousX) return 24
  if (clientX < bounds.left + margin && clientX < previousX) return -24
  return 0
}
