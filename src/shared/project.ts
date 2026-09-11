/**
 * The bay project model.
 *
 * Two rules govern every type in this file, and both are load-bearing:
 *
 * 1. **Time on the timeline is frames, never seconds.** A frame index is exact at a given
 *    fps; a float second is not, and rounding it at each hop is how a cut drifts by a frame
 *    over a long edit. Source offsets into media are the one exception — those are
 *    microseconds, because the source has its own frame rate we do not control.
 * 2. **Assets are the "what", items are the "where and when".** One asset can back many
 *    items. Anything about the source file lives on the asset; anything about a particular
 *    appearance on the timeline lives on the item. Changing where a clip sits must never
 *    require touching the asset.
 */

export type AssetKind = 'video' | 'audio' | 'image' | 'gif' | 'text'
export type TrackKind = 'video' | 'audio'

/** Microseconds. Used for durations and offsets that belong to source media. */
export type Micros = number

/** A frame index or count on a timeline, at that timeline's fps. */
export type Frames = number

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface Asset {
  id: string
  kind: AssetKind
  /** Display name. Defaults to the file's basename, renameable by the user. */
  name: string
  /** Absolute path on this machine, or null for assets that have no file (text). */
  path: string | null
  /** Source duration. Zero for stills. */
  durationUs: Micros
  /** Intrinsic pixel size. Null when the asset has no picture (audio). */
  width: number | null
  height: number | null
  /** Source frame rate, when the source has one. */
  fps: number | null
  hasAudio: boolean
  hasVideo: boolean
  /** Absolute path to a cached poster frame, once one has been generated. */
  posterPath: string | null
  /** Absolute path to a cached peaks file, once one has been generated. */
  waveformPath: string | null
  /** For `kind: 'text'` — the string to draw. */
  text?: string
  createdAt: number
  /** Set when probing failed; the asset still lists, but cannot be placed. */
  error?: string
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Where an item sits on the canvas. Origin is top-left of the canvas, in canvas pixels. */
export interface Layout {
  left: number
  top: number
  width: number
  height: number
  /** 0..1 */
  opacity: number
  /** Degrees, clockwise, about the item's centre. */
  rotation: number
}

export interface Item {
  id: string
  assetId: string
  trackId: string
  /** First frame of this item on the timeline. */
  from: Frames
  /** How many frames it plays for. Always >= 1. */
  durationInFrames: Frames
  /** Where in the source this item starts reading. Ignored for stills. */
  sourceStartUs: Micros
  layout: Layout
  /** 0..2, linear gain applied to this item's own audio. */
  volume: number
  fadeInFrames: Frames
  fadeOutFrames: Frames
  /** Playback rate multiplier. 1 is source speed. */
  speed: number
}

export interface Track {
  id: string
  kind: TrackKind
  /** Display name: V1, V2, A1, A2 … Derived on creation, renameable. */
  name: string
  locked: boolean
  muted: boolean
  hidden: boolean
  items: Item[]
}

export interface Timeline {
  id: string
  name: string
  fps: number
  width: number
  height: number
  /** Background shown wherever no video track has an item. CSS colour. */
  background: string
  /**
   * Video tracks stack: later entries in this array render on top. Audio tracks mix in
   * parallel and their order carries no meaning beyond display.
   */
  tracks: Track[]
}

export interface Project {
  id: string
  name: string
  /** Schema version. Bump when a migration is needed; `migrate()` keys off it. */
  version: number
  assets: Asset[]
  timelines: Timeline[]
  activeTimelineId: string
  createdAt: number
  updatedAt: number
  /** Absolute path this project was last saved to, or null if never saved. */
  filePath?: string | null
}

export const PROJECT_VERSION = 1

// ---------------------------------------------------------------------------
// Time helpers — the only places frames and real time are allowed to meet
// ---------------------------------------------------------------------------

export const US_PER_SECOND = 1_000_000

export function framesToUs(frames: Frames, fps: number): Micros {
  return Math.round((frames / fps) * US_PER_SECOND)
}

export function usToFrames(us: Micros, fps: number): Frames {
  return Math.round((us / US_PER_SECOND) * fps)
}

export function framesToSeconds(frames: Frames, fps: number): number {
  return frames / fps
}

export function secondsToFrames(seconds: number, fps: number): Frames {
  return Math.round(seconds * fps)
}

/** `1:04:09` / `4:09` / `0:09`, plus frames when `withFrames`. */
export function formatTimecode(frames: Frames, fps: number, withFrames = false): string {
  const safeFps = fps > 0 ? fps : 30
  const total = Math.max(0, Math.floor(frames))
  const totalSeconds = Math.floor(total / safeFps)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const rest = total % safeFps
  const pad = (n: number): string => String(n).padStart(2, '0')
  const clock =
    hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
  return withFrames ? `${clock}:${pad(rest)}` : clock
}

// ---------------------------------------------------------------------------
// Queries — pure, shared by the renderer engine, the UI and the main process
// ---------------------------------------------------------------------------

export function itemEnd(item: Item): Frames {
  return item.from + item.durationInFrames
}

export function itemsOverlap(a: Item, b: Item): boolean {
  return a.from < itemEnd(b) && b.from < itemEnd(a)
}

/** Last frame touched by any item, i.e. the timeline's duration. */
export function timelineDuration(timeline: Timeline): Frames {
  let end = 0
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      const itemEndFrame = itemEnd(item)
      if (itemEndFrame > end) end = itemEndFrame
    }
  }
  return end
}

export function findTimeline(project: Project, timelineId: string): Timeline | undefined {
  return project.timelines.find((t) => t.id === timelineId)
}

export function activeTimeline(project: Project): Timeline | undefined {
  return findTimeline(project, project.activeTimelineId)
}

export function findAsset(project: Project, assetId: string): Asset | undefined {
  return project.assets.find((a) => a.id === assetId)
}

export function findTrack(timeline: Timeline, trackId: string): Track | undefined {
  return timeline.tracks.find((t) => t.id === trackId)
}

export function findItem(
  timeline: Timeline,
  itemId: string
): { item: Item; track: Track } | undefined {
  for (const track of timeline.tracks) {
    const item = track.items.find((i) => i.id === itemId)
    if (item) return { item, track }
  }
  return undefined
}

export function allItems(timeline: Timeline): Item[] {
  return timeline.tracks.flatMap((t) => t.items)
}

/**
 * Every item playing at `frame`, ordered the way the compositor must draw them:
 * lowest video track first, so later entries paint on top.
 *
 * **This answers a question about picture, not about sound.** `hidden` and `muted` are two
 * independent properties of a track and they govern two independent outputs:
 *
 * - `hidden` blanks the **picture** and nothing else. A hidden video track carrying speech
 *   keeps being heard. This is what every NLE does, and the reason is editorial: hiding a
 *   layer to see what is underneath it must not silently change the mix you are judging.
 * - `muted` silences the **sound** and nothing else, on a track of either kind — a video
 *   track carries audio, so it needs a mute of its own, and `AudioEngine` honours
 *   `track.muted` regardless of `track.kind`.
 *
 * So a consumer that wants sound must not filter on `hidden`, and must not reach this
 * function for the list — `AudioEngine.update` walks the tracks itself, deliberately,
 * because a muted track still has to reach its analyser or the meter goes dark and the user
 * cannot see what they muted.
 *
 * The trap this replaced: the compositor's "pause anything I did not draw" sweep silenced a
 * hidden track as a side effect, so hiding a picture killed its sound with no way to get it
 * back short of un-hiding. An element is idle only when *neither* the compositor nor the
 * audio engine wants it.
 */
export function itemsAtFrame(timeline: Timeline, frame: Frames, kind?: TrackKind): Item[] {
  const out: Item[] = []
  for (const track of timeline.tracks) {
    if (kind && track.kind !== kind) continue
    if (track.kind === 'video' && track.hidden) continue
    if (track.kind === 'audio' && track.muted) continue
    for (const item of track.items) {
      if (frame >= item.from && frame < itemEnd(item)) out.push(item)
    }
  }
  return out
}

/**
 * Where in the source, in microseconds, item `item` is reading at timeline frame `frame`.
 * Honours `speed`. Callers must have checked the frame is inside the item.
 */
export function sourceTimeAt(item: Item, frame: Frames, fps: number): Micros {
  const elapsed = framesToUs(frame - item.from, fps)
  return item.sourceStartUs + Math.round(elapsed * item.speed)
}

/** The item's own fade envelope at `frame`, 0..1. Multiplies layout opacity / volume. */
export function fadeGainAt(item: Item, frame: Frames): number {
  const local = frame - item.from
  const remaining = item.durationInFrames - local
  let gain = 1
  if (item.fadeInFrames > 0 && local < item.fadeInFrames) {
    gain = Math.min(gain, local / item.fadeInFrames)
  }
  if (item.fadeOutFrames > 0 && remaining < item.fadeOutFrames) {
    gain = Math.min(gain, remaining / item.fadeOutFrames)
  }
  return Math.max(0, Math.min(1, gain))
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function defaultLayout(timeline: Pick<Timeline, 'width' | 'height'>): Layout {
  return {
    left: 0,
    top: 0,
    width: timeline.width,
    height: timeline.height,
    opacity: 1,
    rotation: 0
  }
}

/**
 * The layout that makes an asset *cover* the canvas without distortion — scaled up until
 * both axes are filled, then centred, so the overflow is clipped evenly on both sides.
 * Cropping into the source is a different operation and is deliberately not this one.
 */
export function coverLayout(
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number
): Layout {
  if (sourceWidth <= 0 || sourceHeight <= 0) return defaultLayout(timeline)
  const scale = Math.max(timeline.width / sourceWidth, timeline.height / sourceHeight)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return {
    left: Math.round((timeline.width - width) / 2),
    top: Math.round((timeline.height - height) / 2),
    width,
    height,
    opacity: 1,
    rotation: 0
  }
}

/** The layout that *fits* an asset inside the canvas, letterboxing rather than clipping. */
export function containLayout(
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number
): Layout {
  if (sourceWidth <= 0 || sourceHeight <= 0) return defaultLayout(timeline)
  const scale = Math.min(timeline.width / sourceWidth, timeline.height / sourceHeight)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return {
    left: Math.round((timeline.width - width) / 2),
    top: Math.round((timeline.height - height) / 2),
    width,
    height,
    opacity: 1,
    rotation: 0
  }
}

export interface CanvasPreset {
  id: string
  label: string
  width: number
  height: number
  fps: number
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'landscape-1080', label: '1920 × 1080 · 16:9', width: 1920, height: 1080, fps: 30 },
  { id: 'vertical-1080', label: '1080 × 1920 · 9:16', width: 1080, height: 1920, fps: 30 },
  { id: 'square-1080', label: '1080 × 1080 · 1:1', width: 1080, height: 1080, fps: 30 },
  { id: 'landscape-4k', label: '3840 × 2160 · 4K', width: 3840, height: 2160, fps: 30 }
]
