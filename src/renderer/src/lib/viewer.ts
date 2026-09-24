/**
 * The viewer's own state: guides, zoom, full screen, and the engine handle the meters read.
 *
 * Kept out of the editor store on purpose. None of it is the project, none of it belongs in
 * undo, and none of it is anything the timeline or the inspector re-renders over — and the
 * editor store's slices are the files six teams edit at once.
 *
 * The guides are remembered per machine (`bay.viewer.*`, a compatibility surface like every
 * `localStorage` key: rename one and the setting is lost on upgrade). Zoom and full screen are
 * not: opening bay at 200% or full screen is never what anyone meant.
 */

import { create } from 'zustand'
import type { EngineHandle } from '@/lib/useEngine'
import { remember, remembered } from '@/store/prefs'

export type ViewerZoom = 'fit' | '0.5' | '1' | '2'

export const VIEWER_ZOOMS: readonly { value: ViewerZoom; label: string }[] = [
  { value: 'fit', label: 'Fit' },
  { value: '0.5', label: '50%' },
  { value: '1', label: '100%' },
  { value: '2', label: '200%' }
]

const SAFE_AREAS_KEY = 'bay.viewer.safeAreas'
const GRID_KEY = 'bay.viewer.grid'

interface ViewerState {
  safeAreas: boolean
  grid: boolean
  zoom: ViewerZoom
  fullscreen: boolean
  /**
   * Crop on canvas (⇧C): the selected clip's edges drag its crop insets instead of resizing it.
   * Not remembered — a mode left on would make the next resize a crop.
   */
  cropMode: boolean
  setCropMode(on: boolean): void
  /** The live engine, set by `Preview` while mounted — the meters read its analysers. */
  engine: EngineHandle | null
  toggleSafeAreas(): void
  toggleGrid(): void
  setZoom(zoom: ViewerZoom): void
  setFullscreen(on: boolean): void
  setEngine(engine: EngineHandle | null): void
}

export const useViewer = create<ViewerState>((set, get) => ({
  safeAreas: remembered(SAFE_AREAS_KEY) === '1',
  grid: remembered(GRID_KEY) === '1',
  zoom: 'fit',
  fullscreen: false,
  cropMode: false,
  setCropMode(on) {
    set({ cropMode: on })
  },
  engine: null,
  toggleSafeAreas() {
    const next = !get().safeAreas
    remember(SAFE_AREAS_KEY, next ? '1' : '0')
    set({ safeAreas: next })
  },
  toggleGrid() {
    const next = !get().grid
    remember(GRID_KEY, next ? '1' : '0')
    set({ grid: next })
  },
  setZoom(zoom) {
    set({ zoom })
  },
  setFullscreen(on) {
    set({ fullscreen: on })
  },
  setEngine(engine) {
    set({ engine })
  }
}))

/**
 * Asks the inspector to put the cursor in a text clip's words (a double-click on the preview).
 * An event rather than state: it is a moment, not a condition, and the inspector may not even
 * be mounted. The inspector listens for `bay:focus-text` and focuses its text field when the
 * detail's `itemId` is the one it shows.
 */
export const FOCUS_TEXT_EVENT = 'bay:focus-text'

export function requestTextFocus(itemId: string): void {
  window.dispatchEvent(new CustomEvent(FOCUS_TEXT_EVENT, { detail: { itemId } }))
}
