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
  },
  'view.cropMode': {
    when: ({ state }) => state.screen === 'editor',
    run: ({ state }) => {
      const viewer = useViewer.getState()
      const on = !viewer.cropMode
      viewer.setCropMode(on)
      if (on && state.selection.length !== 1) {
        state.notify('Crop in viewer is on. Select one clip in the preview, then drag its edges. ⇧C or Escape turns it off.')
      }
    }
  }
} satisfies Handlers
