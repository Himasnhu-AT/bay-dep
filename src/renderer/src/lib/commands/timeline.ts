import { gapAt } from '@shared/editing'
import { selectDuration, selectFps, selectSelectedItems, selectTimeline } from '@/store/editor'
import { useTimelineTool } from '@/lib/timelineTool'
import type { CommandContext, Handlers } from './types'

const inEditor = ({ state }: CommandContext): boolean => state.screen === 'editor'

/**
 * The timeline's scroller, found by the attribute `Timeline.tsx` puts on it. Its
 * `data-lane-offset` is the track-header width, the part of the scroller that is not lanes.
 */
function timelineScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-timeline-scroller]')
}

export const timelineHandlers = {
  'timeline.zoomIn': { when: inEditor, run: ({ state }) => state.zoomBy(1.25) },
  'timeline.zoomOut': { when: inEditor, run: ({ state }) => state.zoomBy(1 / 1.25) },
  'timeline.zoomToFit': {
    when: inEditor,
    run: ({ state }) => {
      const scroller = timelineScroller()
      if (!scroller) {
        state.notify('The timeline is hidden. Show it (View) to fit it.')
        return
      }
      const lanes = scroller.clientWidth - Number(scroller.dataset.laneOffset ?? 0) - 24
      // An empty timeline fits ten seconds, the runway the timeline draws when it is empty.
      const frames = Math.max(selectDuration(state), selectFps(state) * 10)
      state.setPixelsPerFrame(Math.max(1, lanes) / frames)
      scroller.scrollLeft = 0
    }
  },
  'timeline.toggleSnapping': {
    when: inEditor,
    run: ({ state }) => {
      state.toggleSnapping()
      state.notify(state.snapping ? 'Snapping off. N turns it back on.' : 'Snapping on. Hold ⌘ while dragging to suspend it.')
    }
  },
  'timeline.toggleLinkedSelection': {
    when: inEditor,
    run: ({ state }) => {
      state.toggleLinkedSelection()
      state.notify(
        state.linkedSelection
          ? 'Linked selection off: clicking a clip selects it alone, and it moves alone.'
          : 'Linked selection on: a clip and its linked sound select and move together.'
      )
    }
  },
  'timeline.closeGap': {
    when: inEditor,
    run: ({ state }) => {
      const timeline = selectTimeline(state)
      if (!timeline) return
      // The selection's tracks first, then every other unlocked track, top of the stack down.
      const selected = new Set(selectSelectedItems(state).map((item) => item.trackId))
      const order = [
        ...timeline.tracks.filter((t) => selected.has(t.id)),
        ...[...timeline.tracks].reverse().filter((t) => !selected.has(t.id))
      ].filter((t) => !t.locked)
      const track = order.find((t) => gapAt(state.project, t, state.playhead).ok)
      if (!track) {
        state.notify('The playhead is not in a gap on any unlocked track. Put it in the empty space between two clips.')
        return
      }
      const result = state.closeGapAt(track.id, state.playhead)
      if ('error' in result) state.notify(result.error, 'error')
      else state.setPlayhead(result.from)
    }
  },
  'tool.select': { when: inEditor, run: () => useTimelineTool.getState().setTool('select') },
  'tool.blade': { when: inEditor, run: () => useTimelineTool.getState().setTool('blade') }
} satisfies Handlers
