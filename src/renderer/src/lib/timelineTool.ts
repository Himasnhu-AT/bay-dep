/**
 * The timeline's pointer tool, and a trim mode armed from the clip menu.
 *
 * Select (A) is the default: click selects, drag moves, edges trim, ⌥ slips, slides and rolls.
 * Blade (B) cuts: a click on a clip splits it at the frame under the pointer (⇧ cuts every
 * track there) through `splitAt`, the store action ⌘B runs. Escape or A goes back to Select.
 *
 * "Armed" is the clip menu's Slip…/Slide…/Roll Edit…: the next drag on a clip is that trim
 * without holding ⌥, then it disarms. It exists so the gestures can be found from a menu.
 *
 * Neither is the project or undoable, so both live here rather than in the editor store, and
 * neither is remembered: opening bay with the blade in hand would cut on the first click.
 */

import { create } from 'zustand'
import type { TrimMode } from '@shared/trim'

export type TimelineTool = 'select' | 'blade'

interface TimelineToolState {
  tool: TimelineTool
  armed: TrimMode | null
  setTool(tool: TimelineTool): void
  arm(mode: TrimMode | null): void
}

export const useTimelineTool = create<TimelineToolState>((set) => ({
  tool: 'select',
  armed: null,
  // Picking a tool drops an armed trim: the two are different answers to "what does a drag do".
  setTool: (tool) => set({ tool, armed: null }),
  arm: (mode) => set(mode ? { armed: mode, tool: 'select' } : { armed: null })
}))

/** What a trim mode is called where a person reads it. */
export const TRIM_MODE_LABEL: Record<TrimMode, string> = { slip: 'Slip', slide: 'Slide', roll: 'Roll' }

/**
 * A blade cursor: a vertical cut line with a small blade, white-edged so it reads on the dark
 * lanes and over a bright filmstrip. The hot spot is the line's middle.
 */
export const BLADE_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
      "<path d='M12 2v20' stroke='white' stroke-width='3'/><path d='M12 2v20' stroke='black' stroke-width='1'/>" +
      "<path d='M12 3 L19 7 L12 11 Z' fill='black' stroke='white' stroke-width='1'/></svg>"
  )}") 12 12, crosshair`
