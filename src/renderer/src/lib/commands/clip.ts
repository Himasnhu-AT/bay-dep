import { closeSelectedGap } from '../timelineView'
import type { Handlers } from './types'

export const clipHandlers = {
  'clip.split': { run: ({ state }) => state.splitAt() },
  'clip.duplicate': { run: ({ state }) => state.duplicateSelected() },
  // A selected gap (clicked on an empty lane) is what Delete acts on; either key closes it.
  'clip.delete': { run: ({ state }) => void (closeSelectedGap() || state.deleteSelected()) },
  'clip.rippleDelete': { run: ({ state }) => void (closeSelectedGap() || state.rippleDelete()) }
} satisfies Handlers
