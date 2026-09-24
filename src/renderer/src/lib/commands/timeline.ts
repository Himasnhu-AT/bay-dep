import type { Handlers } from './types'

export const timelineHandlers = {
  'timeline.zoomIn': { run: ({ state }) => state.zoomBy(1.25) },
  'timeline.zoomOut': { run: ({ state }) => state.zoomBy(1 / 1.25) }
} satisfies Handlers
