import { adjacentPoint, editPoints, markerPoints } from '@shared/editing'
import { selectDuration, selectTimeline } from '@/store/editor'
import { shuttle, stopShuttle } from '@/lib/shuttle'
import type { CommandContext, Handlers } from './types'

const inEditor = ({ state }: CommandContext): boolean => state.screen === 'editor'

function jump(kind: 'edit' | 'marker', direction: 1 | -1) {
  return {
    when: inEditor,
    run: ({ state }: CommandContext) => {
      const timeline = selectTimeline(state)
      if (!timeline) return
      const points = kind === 'edit' ? editPoints(timeline) : markerPoints(timeline)
      const target = adjacentPoint(points, state.playhead, direction)
      if (target === null) {
        state.notify(
          kind === 'marker'
            ? points.length === 0
              ? 'There are no markers. M adds one at the playhead.'
              : `No marker ${direction === 1 ? 'after' : 'before'} the playhead.`
            : `No edit ${direction === 1 ? 'after' : 'before'} the playhead.`
        )
        return
      }
      stopShuttle()
      state.setPlaying(false)
      state.setPlayhead(target)
    }
  }
}

export const playbackHandlers = {
  'playback.toggle': {
    run: ({ state }) => {
      // Space during a J/L shuttle stops it, as K would; otherwise it is plain play/pause.
      if (stopShuttle()) return
      state.togglePlay()
    }
  },
  'playback.shuttleReverse': { when: inEditor, run: ({ source }) => shuttle('J', source) },
  'playback.shuttleStop': { when: inEditor, run: ({ source }) => shuttle('K', source) },
  'playback.shuttleForward': { when: inEditor, run: ({ source }) => shuttle('L', source) },
  'playback.toggleLoop': {
    when: inEditor,
    run: ({ state }) => {
      state.toggleLoop()
      const on = !state.loop
      const span = state.rangeIn !== null || state.rangeOut !== null ? 'In to Out' : 'the whole timeline'
      state.notify(on ? `Loop playback on: plays ${span} over and over. ⌘L turns it off.` : 'Loop playback off.')
    }
  },
  'playback.stepBack': { run: ({ state }) => state.nudgePlayhead(-1) },
  'playback.stepForward': { run: ({ state }) => state.nudgePlayhead(1) },
  'playback.stepBackMany': { run: ({ state }) => state.nudgePlayhead(-10) },
  'playback.stepForwardMany': { run: ({ state }) => state.nudgePlayhead(10) },
  'playback.prevEdit': jump('edit', -1),
  'playback.nextEdit': jump('edit', 1),
  'playback.prevMarker': jump('marker', -1),
  'playback.nextMarker': jump('marker', 1),
  'playback.toStart': { run: ({ state }) => state.setPlayhead(0) },
  'playback.toEnd': { run: ({ state }) => state.setPlayhead(selectDuration(state)) }
} satisfies Handlers
