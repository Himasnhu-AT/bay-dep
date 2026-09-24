import { useViewer } from '@/lib/viewer'
import type { Handlers } from './types'

export const viewHandlers = {
  'view.toggleDebug': { run: ({ state }) => state.toggleDebugMode() },
  'view.safeAreas': { run: () => useViewer.getState().toggleSafeAreas() },
  'view.grid': { run: () => useViewer.getState().toggleGrid() },
  'view.fullscreenPreview': {
    run: () => {
      const viewer = useViewer.getState()
      viewer.setFullscreen(!viewer.fullscreen)
    }
  }
} satisfies Handlers
