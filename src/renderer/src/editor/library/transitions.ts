/**
 * The Effects Library's transitions: which cut a click applies to, and applying it — the same
 * store calls ⌘T and the transition dialog make, so a transition put on from the library is the
 * one `add_transition` would put there, at the length Preferences › Editing gives.
 */

import { formatTimecode, type Frames, type Project, type Timeline, type TransitionDirection, type TransitionKind } from '@shared/project'
import { defaultTransitionFrames, junctionsForTrack, whyNoRoom, type Junction } from '@/lib/junctions'
import { selectTimeline, useEditor } from '@/store/editor'

export type CutTrackKind = 'video' | 'audio'

/** Kinds that travel, and so need a direction. */
export const DIRECTIONAL: ReadonlySet<TransitionKind> = new Set<TransitionKind>(['wipe', 'push', 'slide'])

export const VIDEO_TRANSITIONS: readonly { kind: TransitionKind; label: string; description: string }[] = [
  { kind: 'cross-dissolve', label: 'Cross Dissolve', description: 'One shot melts into the next' },
  { kind: 'dip-to-black', label: 'Dip to Black', description: 'Out to black, then in: a scene break' },
  { kind: 'dip-to-white', label: 'Dip to White', description: 'Out to white, then in: a flash' },
  { kind: 'wipe', label: 'Wipe', description: 'A hard edge crosses the frame' },
  { kind: 'push', label: 'Push', description: 'The new shot pushes the old one out' },
  { kind: 'slide', label: 'Slide', description: 'The new shot slides in over the old' },
  { kind: 'iris', label: 'Iris', description: 'A circle opens on the new shot' }
]

/**
 * On an audio track the same stored kinds are heard, not seen: a cross dissolve's gains are an
 * equal-power cross-fade, and a dip is both sides silent at the midpoint (`transitionAudioGains`).
 */
export const AUDIO_TRANSITIONS: readonly { kind: TransitionKind; label: string; description: string }[] = [
  { kind: 'cross-dissolve', label: 'Cross-fade', description: 'One sound fades into the next' },
  { kind: 'dip-to-black', label: 'Dip', description: 'Down to silence, then back up' }
]

/**
 * The cut a library click acts on, on a track of `kind`: the cut between two selected clips that
 * meet, if the selection names one (the nearest thing bay has to selecting a junction); else the cut
 * nearest `frame` on the selection's tracks; else the nearest on any track of that kind. Ties go to
 * the earlier cut. Null when there is no cut on such a track.
 */
export function targetJunction(
  project: Project,
  timeline: Timeline,
  frame: Frames,
  kind: CutTrackKind,
  selection: readonly string[]
): Junction | null {
  return nearestCandidate(junctionCandidates(project, timeline, kind, selection), frame)
}

/**
 * The cuts `targetJunction` chooses among, before the playhead is consulted: the cut between two
 * selected clips if there is one, else the pool the nearest is taken from. Split out so a view
 * that follows the playhead can work this out once per edit (`memoJunctionCandidates`) rather
 * than walk every track's cuts on every frame.
 */
export interface JunctionCandidates {
  between: Junction | null
  pool: readonly Junction[]
}

export function junctionCandidates(project: Project, timeline: Timeline, kind: CutTrackKind, selection: readonly string[]): JunctionCandidates {
  const all = timeline.tracks
    .filter((track) => track.kind === kind)
    .flatMap((track) => junctionsForTrack(project, timeline, track))
  const chosen = new Set(selection)
  const between = all.find((junction) => chosen.has(junction.from.id) && chosen.has(junction.to.id)) ?? null
  if (between) return { between, pool: [] }
  const selectedTracks = new Set(
    timeline.tracks.filter((track) => track.items.some((item) => chosen.has(item.id))).map((track) => track.id)
  )
  const preferred = all.filter((junction) => selectedTracks.has(junction.trackId))
  return { between: null, pool: preferred.length > 0 ? preferred : all }
}

export function nearestCandidate(candidates: JunctionCandidates, frame: Frames): Junction | null {
  if (candidates.between) return candidates.between
  let best: Junction | null = null
  for (const junction of candidates.pool) {
    if (!best || Math.abs(junction.cutFrame - frame) < Math.abs(best.cutFrame - frame)) best = junction
  }
  return best
}

/**
 * `junctionCandidates`, remembered for the last project, selection and kind it was asked about —
 * by identity, since every edit makes a new project and every selection change a new array. A
 * store selector runs on every store change, the playhead's included; with this, a frame of
 * playback costs a scan of the cuts already found, not finding them again.
 */
export function memoJunctionCandidates(): (project: Project, timeline: Timeline, kind: CutTrackKind, selection: readonly string[]) => JunctionCandidates {
  let last: { project: Project; timeline: Timeline; kind: CutTrackKind; selection: readonly string[]; result: JunctionCandidates } | null = null
  return (project, timeline, kind, selection) => {
    if (last && last.project === project && last.timeline === timeline && last.kind === kind && last.selection === selection) return last.result
    const result = junctionCandidates(project, timeline, kind, selection)
    last = { project, timeline, kind, selection, result }
    return result
  }
}

/** Where a library click would put a transition, as the editor's store sees it now. */
export function currentTarget(kind: CutTrackKind): Junction | null {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  if (!timeline) return null
  return targetJunction(state.project, timeline, state.playhead, kind, state.selection)
}

/**
 * Puts `transition` on the target cut, or changes the one already there to this kind (keeping its
 * length, and its direction when both travel), as one undo step. Says what happened, or why not.
 * Returns the cut it acted on, or null.
 */
export function applyTransition(transition: TransitionKind, kind: CutTrackKind, label: string): Junction | null {
  const state = useEditor.getState()
  const timeline = selectTimeline(state)
  if (!timeline) return null
  const junction = targetJunction(state.project, timeline, state.playhead, kind, state.selection)
  if (!junction) {
    state.notify(
      kind === 'video'
        ? 'There is no cut to put a transition on: two clips must touch on one video track.'
        : 'There is no cut on an audio track: two sounds must touch on one audio track. A video clip’s own sound follows its picture’s transition.'
    )
    return null
  }
  const reason = whyNoRoom(junction)
  if (reason) {
    state.notify(reason, 'error')
    return null
  }
  const existing = junction.transition
  const direction: TransitionDirection | undefined = DIRECTIONAL.has(transition) ? (existing?.direction ?? 'left') : undefined
  let error: string | null = null
  state.transact(() => {
    if (existing) {
      state.patchTransition(existing.id, { kind: transition, direction })
    } else {
      const outcome = state.addTransition({
        fromItemId: junction.from.id,
        toItemId: junction.to.id,
        kind: transition,
        durationInFrames: defaultTransitionFrames(junction, timeline.fps),
        ...(direction ? { direction } : {})
      })
      if ('error' in outcome) error = outcome.error
    }
  })
  if (error) {
    state.notify(error, 'error')
    return null
  }
  const track = timeline.tracks.find((t) => t.id === junction.trackId)?.name ?? 'its track'
  const at = formatTimecode(junction.cutFrame, timeline.fps, true)
  state.notify(`${label} ${existing ? 'now on' : 'added to'} the cut at ${at} on ${track}. ⌘Z to undo.`)
  return junction
}
