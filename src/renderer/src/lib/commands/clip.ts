import { defaultTransitionFrames, nearestJunction, whyNoRoom } from '@/lib/junctions'
import { selectSelectedItems, selectTimeline } from '@/store/editor'
import type { CommandContext, Handlers } from './types'

const inEditor = ({ state }: CommandContext): boolean => state.screen === 'editor'

function nudge(frames: number) {
  return { when: inEditor, run: ({ state }: CommandContext) => void state.nudgeSelection(frames) }
}

export const clipHandlers = {
  'clip.split': { when: inEditor, run: ({ state }) => state.splitAt() },
  'clip.splitAll': { when: inEditor, run: ({ state }) => state.splitAt(undefined, { allTracks: true }) },
  'clip.duplicate': { when: inEditor, run: ({ state }) => state.duplicateSelected() },
  'clip.trimStartRipple': { when: inEditor, run: ({ state }) => state.trimToPlayhead('start', true) },
  'clip.trimEndRipple': { when: inEditor, run: ({ state }) => state.trimToPlayhead('end', true) },
  'clip.trimStart': { when: inEditor, run: ({ state }) => state.trimToPlayhead('start', false) },
  'clip.trimEnd': { when: inEditor, run: ({ state }) => state.trimToPlayhead('end', false) },
  'clip.nudgeLeft': nudge(-1),
  'clip.nudgeRight': nudge(1),
  'clip.nudgeLeftMany': nudge(-10),
  'clip.nudgeRightMany': nudge(10),
  'clip.toggleEnabled': { when: inEditor, run: ({ state }) => state.toggleDisabled() },
  'clip.addTransition': {
    when: inEditor,
    run: ({ state }) => {
      const timeline = selectTimeline(state)
      if (!timeline) return
      const preferred = [...new Set(selectSelectedItems(state).map((item) => item.trackId))]
      const junction = nearestJunction(state.project, timeline, state.playhead, preferred)
      if (!junction) {
        state.notify('There is no cut to put a transition on: two clips must touch on one video track.')
        return
      }
      const reason = whyNoRoom(junction)
      if (reason) {
        state.notify(reason, 'error')
        return
      }
      // The store call `add_transition` makes, with the length it picks when none is given.
      const outcome = state.addTransition({
        fromItemId: junction.from.id,
        toItemId: junction.to.id,
        kind: junction.transition?.kind ?? 'cross-dissolve',
        durationInFrames: junction.transition?.durationInFrames ?? defaultTransitionFrames(junction, timeline.fps)
      })
      if ('error' in outcome) state.notify(outcome.error, 'error')
      else if (junction.transition) state.notify('That cut already has a transition. Click its marker on the timeline to change it.')
      else state.setPlayhead(junction.cutFrame)
    }
  },
  'clip.delete': { when: inEditor, run: ({ state }) => state.deleteSelected() },
  'clip.rippleDelete': { when: inEditor, run: ({ state }) => void state.rippleDelete() }
} satisfies Handlers

