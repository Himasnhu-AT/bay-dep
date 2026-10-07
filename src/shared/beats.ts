/**
 * Beat grids: what `detect_beats` stores on an asset, and the one mapping from a grid in
 * source time onto the timeline.
 *
 * The grid is kept in **source microseconds** because it describes the file, not a placement:
 * one song placed twice, or trimmed, or played at 1.1×, has one grid and two sets of timeline
 * beats. `beatFramesForItem` is the only place that mapping is done — the tool's answer, the
 * markers it suggests and the timeline's snapping all read it, so the frame an agent is told is
 * the frame a drag snaps to.
 */

import { effectiveSpeed, itemEnd, itemFrameAtSource, plainTime, type Frames, type Item, type Micros, type Project, type Timeline, US_PER_SECOND } from './project'

/**
 * Bumped whenever the analysis changes what it would answer, so a grid stored by an older
 * build is recognised as stale and recomputed rather than trusted.
 */
export const BEAT_ANALYSIS_VERSION = 1

export interface BeatDropout {
  startUs: Micros
  endUs: Micros
  /**
   * `percussion`: the beat stops (sound may carry on); `startUs` is the first beat that does not
   * come — where a cut "on the drop" lands. `silence`: the level itself falls far under the music.
   */
  kind: 'percussion' | 'silence'
}

export interface BeatGrid {
  version: number
  bpm: number
  /** 0..1: how strongly the onsets repeat at this tempo. Under ~0.3 the grid is a guess. */
  confidence: number
  beatsPerBar: number
  /** Every beat, in microseconds from the start of the source file. */
  beatsUs: Micros[]
  /** The first beat of each bar — a subset of `beatsUs`. Empty when the bar could not be found. */
  downbeatsUs: Micros[]
  downbeatConfidence: number
  dropouts: BeatDropout[]
}

/** Under this confidence a grid is a guess, not a beat: see `hasSteadyBeat`. */
export const STEADY_BEAT_CONFIDENCE = 0.3

/**
 * Whether a stored grid describes a beat anyone should cut or snap to. A failed analysis still
 * answers with a tempo and a grid (a sine tone came back as 178 BPM at confidence 0), and that
 * grid is kept on the asset so asking again does not re-analyse — but it is not a beat. The
 * tool's `next`, the media card's tempo and the timeline's snapping all ask here, so they cannot
 * disagree about which grids count.
 */
export function hasSteadyBeat(grid: BeatGrid | undefined | null): grid is BeatGrid {
  return !!grid && grid.confidence >= STEADY_BEAT_CONFIDENCE && grid.beatsUs.length > 0
}

/**
 * The timeline frame at which `item` plays source time `us`, or null when the item does not
 * play that moment (it is before the in-point or past the out-point). The inverse of
 * `sourceTimeAt`, speed included.
 */
export function timelineFrameAt(item: Item, us: Micros, fps: number): Frames | null {
  if (!plainTime(item)) {
    const frame = frameOf(item, us, fps)
    return Number.isFinite(frame) && frame >= item.from && frame < itemEnd(item) ? frame : null
  }
  if (us < item.sourceStartUs) return null
  const frame = frameOf(item, us, fps)
  return frame < itemEnd(item) ? frame : null
}

/** Where source time `us` falls on the timeline for `item`, whether or not the item plays it. */
function frameOf(item: Item, us: Micros, fps: number): Frames {
  if (!plainTime(item)) {
    // Through the one mapping's inverse. A reversed clip's frame `f` shows the stretch that ends
    // on boundary `f + 1`, so the frame holding a moment is the boundary rounded up, less one.
    const boundary = itemFrameAtSource(item, us, fps)
    return item.from + (item.reverse ? Math.ceil(boundary) - 1 : Math.round(boundary))
  }
  const elapsedUs = (us - item.sourceStartUs) / effectiveSpeed(item.speed)
  return item.from + Math.round((elapsedUs / US_PER_SECOND) * fps)
}

export interface ItemBeats {
  beats: Frames[]
  downbeats: Frames[]
  /** Clipped to what the item plays; an end past the item is the item's end. */
  dropouts: { startFrame: Frames; endFrame: Frames; kind: BeatDropout['kind'] }[]
}

/** The grid's beats, downbeats and drop-outs where `item` plays them, in timeline frames. */
export function beatFramesForItem(grid: BeatGrid, item: Item, fps: number): ItemBeats {
  const map = (list: Micros[]): Frames[] => {
    const out: Frames[] = []
    for (const us of list) {
      const frame = timelineFrameAt(item, us, fps)
      // Two beats rounding onto one frame (a very fast tempo at a low frame rate) is one place to cut.
      if (frame !== null && out[out.length - 1] !== frame) out.push(frame)
    }
    return out
  }
  const dropouts: ItemBeats['dropouts'] = []
  for (const d of grid.dropouts) {
    const a = frameOf(item, d.startUs, fps)
    const b = frameOf(item, d.endUs, fps)
    // Earliest first on the timeline, whichever way the clip plays the drop-out.
    const startFrame = Math.max(item.from, Math.min(a, b))
    const endFrame = Math.min(itemEnd(item), Math.max(a, b))
    if (endFrame > startFrame) dropouts.push({ startFrame, endFrame, kind: d.kind })
  }
  return { beats: map(grid.beatsUs), downbeats: map(grid.downbeatsUs), dropouts }
}

/**
 * Every beat on the timeline that a drag should snap to: the beats of each placed item whose
 * asset has a steady grid, skipping `ignore` (the items being dragged — their own beats move with
 * them). Sorted and without repeats.
 */
export function beatSnapFrames(project: Project, timeline: Timeline, ignore: ReadonlySet<string>): Frames[] {
  const grids = new Map(project.assets.filter((a) => hasSteadyBeat(a.beats)).map((a) => [a.id, a.beats!]))
  if (grids.size === 0) return []
  const frames = new Set<Frames>()
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      const grid = grids.get(item.assetId)
      if (!grid || ignore.has(item.id)) continue
      for (const frame of beatFramesForItem(grid, item, timeline.fps).beats) frames.add(frame)
    }
  }
  return [...frames].sort((a, b) => a - b)
}
