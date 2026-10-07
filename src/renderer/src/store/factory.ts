/**
 * Building blank projects, timelines and tracks, and the small helpers the store's actions share
 * that need no store state.
 */

import {
  CANVAS_PRESETS,
  PROJECT_VERSION,
  itemsOverlap,
  type Frames,
  type Item,
  type Project,
  type Timeline,
  type Track,
  type TrackKind
} from '@shared/project'

let idCounter = 0
export function newId(prefix: string): string {
  idCounter += 1
  const random = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  // The random part comes first. Tools accept an id's first 10 characters, and with the time
  // first every id made in the same second began alike — a placed video and the sound clip made
  // with it shared their first 12, so the prefix the tools promise matched both.
  return `${prefix}_${random}${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function makeTrack(kind: TrackKind, index: number): Track {
  return {
    id: newId('trk'),
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${index}`,
    locked: false,
    muted: false,
    hidden: false,
    items: []
  }
}

export function emptyTimeline(preset = CANVAS_PRESETS[0]!): Timeline {
  return {
    id: newId('tl'),
    name: 'Timeline 1',
    fps: preset.fps,
    width: preset.width,
    height: preset.height,
    background: '#000000',
    tracks: [makeTrack('video', 1), makeTrack('audio', 1)]
  }
}

export function emptyProject(): Project {
  const timeline = emptyTimeline()
  const now = Date.now()
  return {
    id: newId('prj'),
    name: 'Untitled',
    version: PROJECT_VERSION,
    assets: [],
    timelines: [timeline],
    activeTimelineId: timeline.id,
    createdAt: now,
    updatedAt: now,
    filePath: null
  }
}

/**
 * A deep copy. It had a JSON fallback "for the odd environment that lacks" `structuredClone`;
 * both places this runs — Electron's Chromium and Node under `pnpm test` — always have it, so the
 * fallback could never run and nothing could tell its presence from its absence.
 */
export function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * "V N" / "A N" for the lowest N no track of that kind is called — the rule markers follow.
 * Counting the tracks named a new one after a track that still existed once any had been
 * deleted: remove V2 of three and the next new track was a second "V3".
 */
export function nextTrackName(timeline: Timeline, kind: TrackKind): string {
  const prefix = kind === 'video' ? 'V' : 'A'
  const taken = new Set(timeline.tracks.filter((t) => t.kind === kind).map((t) => t.name))
  let n = 1
  while (taken.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

/**
 * "Marker N" for the lowest N no marker is called: counting the list named a new marker after
 * one that still existed once any had been deleted — two "Marker 2" rows in the markers list.
 */
export function nextMarkerName(markers: readonly { label: string }[] | undefined): string {
  const taken = new Set((markers ?? []).map((marker) => marker.label))
  let n = 1
  while (taken.has(`Marker ${n}`)) n += 1
  return `Marker ${n}`
}

/** The first track of `kind` with room for [from, from+duration), or null if none has. */
export function trackWithRoom(
  timeline: Timeline,
  kind: TrackKind,
  from: Frames,
  duration: Frames
): Track | null {
  const probe = { from, durationInFrames: duration } as Item
  for (const track of timeline.tracks) {
    if (track.kind !== kind || track.locked) continue
    if (!track.items.some((existing) => itemsOverlap(existing, probe))) return track
  }
  return null
}

/**
 * Where a clip of `kind` covering [from, from+duration) goes when it is aimed at `laneId` — a drop
 * onto a lane, "Add text here", the source monitor's edit onto its track, `place_asset` with a
 * `trackId`. Placement never overwrites: the lane itself when it is the right kind, unlocked and
 * free for that span; otherwise the track of `kind` with room that is *displayed* nearest to it
 * (ties go to the lower-numbered track); null when none has room, and the caller adds a lane.
 * With no lane, the first track of `kind` with room (`trackWithRoom`).
 *
 * The drop used to take the lane as given: a still landed on top of a clip on V1, three drops at
 * one frame stacked three clips, and a sound dropped on V1 became a clip on a video track.
 */
export function placementTrack(
  timeline: Timeline,
  kind: TrackKind,
  from: Frames,
  duration: Frames,
  laneId?: string
): Track | null {
  const lane = laneId ? timeline.tracks.find((track) => track.id === laneId) : undefined
  if (!lane) return trackWithRoom(timeline, kind, from, duration)
  // The order the timeline draws them in, top to bottom (`displayOrder` in lib/timelineLayout,
  // which the store may not import): video reversed, then audio as stored.
  const shown = [
    ...timeline.tracks.filter((track) => track.kind === 'video').reverse(),
    ...timeline.tracks.filter((track) => track.kind === 'audio')
  ]
  const at = shown.indexOf(lane)
  const probe = { from, durationInFrames: duration } as Item
  let best: Track | null = null
  let bestDistance = Infinity
  // Array order, so on a tie the first found — the lower-numbered track — is kept.
  for (const track of timeline.tracks) {
    if (track.kind !== kind || track.locked) continue
    if (track.items.some((existing) => itemsOverlap(existing, probe))) continue
    const distance = Math.abs(shown.indexOf(track) - at)
    if (distance < bestDistance) {
      best = track
      bestDistance = distance
    }
  }
  return best
}
