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
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`
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

export function nextTrackName(timeline: Timeline, kind: TrackKind): string {
  const count = timeline.tracks.filter((t) => t.kind === kind).length
  return `${kind === 'video' ? 'V' : 'A'}${count + 1}`
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
