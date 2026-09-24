import { selectTimeline } from '@/store/editor'
import type { Handlers } from './types'

export const markHandlers = {
  'mark.add': { run: ({ state }) => state.addMarker(state.playhead) },
  // Takes back whatever is on this frame, so a mis-placed marker is undone where it was made
  // without hunting for it on the ruler.
  'mark.removeHere': {
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
  }
} satisfies Handlers
