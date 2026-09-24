import { selectTimeline } from '@/store/editor'
import { requestCommentComposer } from '@/lib/commentComposer'
import type { CommandContext, Handlers } from './types'

const inEditor = ({ state }: CommandContext): boolean => state.screen === 'editor'

export const markHandlers = {
  'mark.add': { when: inEditor, run: ({ state }) => void state.addMarker(state.playhead) },
  // Takes back whatever is on this frame, so a mis-placed marker is undone where it was made
  // without hunting for it on the ruler.
  'mark.removeHere': {
    when: inEditor,
    run: ({ state }) => {
      const here = (selectTimeline(state)?.markers ?? []).filter((m) => m.frame === state.playhead)
      if (here.length === 0) {
        state.notify('No marker on this frame to remove.')
        return
      }
      state.transact(() => {
        for (const marker of here) state.removeMarker(marker.id)
      })
    }
  },
  // Opens the toolbar's Comments popover on a new note at the playhead: a comment is its words,
  // so there is nothing to add until they are typed.
  'mark.addComment': {
    when: inEditor,
    run: ({ state }) => {
      if (!requestCommentComposer()) state.notify('Open the timeline to add a comment.')
    }
  },
  'mark.setIn': { when: inEditor, run: ({ state }) => state.setRangeIn(state.playhead) },
  // Out is exclusive: the playhead's frame is the first one after the range.
  'mark.setOut': {
    when: inEditor,
    run: ({ state }) => {
      if (state.playhead === 0) {
        state.notify('Out is the first frame after the range, so it cannot be frame 0. Move the playhead later.')
        return
      }
      state.setRangeOut(state.playhead)
    }
  },
  'mark.clearRange': { when: inEditor, run: ({ state }) => state.clearRange() },
  'mark.goToIn': {
    when: inEditor,
    run: ({ state }) => {
      if (state.rangeIn === null) state.notify('No In point is set. Press I to set one at the playhead.')
      else state.setPlayhead(state.rangeIn)
    }
  },
  'mark.goToOut': {
    when: inEditor,
    run: ({ state }) => {
      if (state.rangeOut === null) state.notify('No Out point is set. Press O to set one at the playhead.')
      else state.setPlayhead(state.rangeOut)
    }
  },
  'mark.removeRange': { when: inEditor, run: ({ state }) => state.removeInOutRange() }
} satisfies Handlers
