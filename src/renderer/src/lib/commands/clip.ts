import type { Handlers } from './types'

export const clipHandlers = {
  'clip.split': { run: ({ state }) => state.splitAt() },
  'clip.duplicate': { run: ({ state }) => state.duplicateSelected() },
  'clip.delete': { run: ({ state }) => state.deleteSelected() },
  'clip.rippleDelete': { run: ({ state }) => void state.rippleDelete() }
} satisfies Handlers
