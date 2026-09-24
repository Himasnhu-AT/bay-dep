import type { Handlers } from './types'

export const viewHandlers = {
  'view.toggleDebug': { run: ({ state }) => state.toggleDebugMode() }
} satisfies Handlers
