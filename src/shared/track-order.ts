/**
 * Moving a track up or down its stack.
 *
 * A track's place is its number — V1 is the first video track in `timeline.tracks` and draws
 * lowest, A1 the first audio track — and only its place *among tracks of its kind* means
 * anything: the compositor stacks video tracks in array order and audio has no stacking, so how
 * the two kinds are interleaved in the array changes nothing anyone can see or hear
 * (`displayOrder` in the timeline lists them apart). So a move is "make this track V2", and it
 * permutes the tracks of one kind among the array slots that kind already holds.
 *
 * Nothing else has to follow. Clips are inside their track and move with it; transitions name
 * clips, links name clips, and ducking names its key track by id — none of them know positions.
 *
 * A track still called by its number ("V2" on the second video track) is renamed to its new
 * number, because that name was never chosen: left alone, the header would read "V2" on V1. A
 * track someone named keeps its name.
 */

import type { Timeline, Track, TrackKind } from './project'

const prefix = (kind: TrackKind): string => (kind === 'video' ? 'V' : 'A')

/** Every track's number in its stack, by id: "V1" for the first video track in the array, and so on. */
export function trackNumbers(tracks: readonly Pick<Track, 'id' | 'kind'>[]): Map<string, string> {
  const out = new Map<string, string>()
  const count = { video: 0, audio: 0 }
  for (const track of tracks) out.set(track.id, `${prefix(track.kind)}${(count[track.kind] += 1)}`)
  return out
}

export const trackNumber = (tracks: readonly Pick<Track, 'id' | 'kind'>[], trackId: string): string | undefined =>
  trackNumbers(tracks).get(trackId)

export interface TrackMoved {
  trackId: string
  kind: TrackKind
  /** 1-based places among tracks of its kind: V1 is 1. */
  from: number
  to: number
  /** Tracks whose default name followed them to a new number: id, old name, new name. */
  renamed: { trackId: string; was: string; now: string }[]
}

/**
 * `timeline.tracks` with `trackId` at `position` among tracks of its kind (1 is V1 / A1), or why
 * not. Reads only; the caller assigns `tracks`. A move to where the track already is is refused
 * rather than answered `ok` — nothing would change, and an agent told "moved" builds on it.
 */
export function planTrackMove(
  timeline: Pick<Timeline, 'tracks'>,
  trackId: string,
  position: number
): { tracks: Track[]; moved: TrackMoved } | { error: string } {
  const track = timeline.tracks.find((candidate) => candidate.id === trackId)
  if (!track) {
    const known = timeline.tracks.map((candidate) => `${candidate.id} (${trackNumber(timeline.tracks, candidate.id)}, “${candidate.name}”)`)
    return { error: `No track has the id "${trackId}". The tracks are: ${known.join('; ')}.` }
  }
  const letter = prefix(track.kind)
  const kindWord = track.kind === 'video' ? 'video' : 'audio'
  const slots = timeline.tracks.map((candidate, index) => (candidate.kind === track.kind ? index : -1)).filter((index) => index >= 0)
  const ofKind = slots.map((index) => timeline.tracks[index]!)
  const from = ofKind.findIndex((candidate) => candidate.id === trackId) + 1
  if (!Number.isInteger(position) || position < 1 || position > ofKind.length) {
    return {
      error:
        ofKind.length === 1
          ? `“${track.name}” is the only ${kindWord} track, so there is nowhere to move it. Add a ${kindWord} track first (add_track).`
          : `There is no ${letter}${position}: this timeline has ${ofKind.length} ${kindWord} tracks, so position runs from 1 (${letter}1${
              track.kind === 'video' ? ', drawn lowest' : ''
            }) to ${ofKind.length}. “${track.name}” is at ${from}.`
    }
  }
  if (position === from) return { error: `“${track.name}” is already ${letter}${from}. Nothing was moved.` }

  const reordered = ofKind.filter((candidate) => candidate.id !== trackId)
  reordered.splice(position - 1, 0, track)
  const renamed: TrackMoved['renamed'] = []
  const tracks = [...timeline.tracks]
  reordered.forEach((candidate, index) => {
    const was = ofKind.findIndex((old) => old.id === candidate.id) + 1
    const followsNumber = candidate.name === `${letter}${was}`
    const now = `${letter}${index + 1}`
    if (followsNumber && candidate.name !== now) {
      renamed.push({ trackId: candidate.id, was: candidate.name, now })
      tracks[slots[index]!] = { ...candidate, name: now }
    } else {
      tracks[slots[index]!] = candidate
    }
  })
  return { tracks, moved: { trackId, kind: track.kind, from, to: position, renamed } }
}
