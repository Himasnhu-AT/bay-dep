/**
 * The timeline's pointer tool, and a trim mode armed from the clip menu.
 *
 * Select (A) is the default: click selects, drag moves, edges trim, ⌥ slips, slides and rolls.
 * Trim (T in Resolve) is a persistent trim mode: every drag on a clip is the trim picked in the
 * toolbar's Trim menu — ripple (an edge moves and what follows closes up or makes room), roll
 * (the cut moves), slip (the footage moves) or slide (the clip moves between its neighbours).
 * Blade (B) cuts: a click on a clip splits it at the frame under the pointer (⇧ cuts every
 * track there) through `splitAt`, the store action ⌘B runs. Escape or A goes back to Select.
 *
 * "Armed" is the clip menu's Slip…/Slide…/Roll Edit…: the next drag on a clip is that trim
 * without holding ⌥, then it disarms. It exists so the gestures can be found from a menu.
 *
 * None of this is the project or undoable, so it lives here rather than in the editor store, and
 * the tool is not remembered: opening bay with the blade in hand would cut on the first click.
 * The trim mode is only the Trim tool's setting, so it is kept while another tool is in hand.
 */

import { create } from 'zustand'
import type { TrimMode } from '@shared/trim'

export type TimelineTool = 'select' | 'trim' | 'blade'

/** What a drag does with the Trim tool in hand: the three `@shared/trim` modes, and ripple. */
export type TrimToolMode = 'ripple' | TrimMode

interface TimelineToolState {
  tool: TimelineTool
  armed: TrimMode | null
  trimMode: TrimToolMode
  setTool(tool: TimelineTool): void
  arm(mode: TrimMode | null): void
  /** Picks the Trim tool's mode and takes the Trim tool up. */
  setTrimMode(mode: TrimToolMode): void
}

export const useTimelineTool = create<TimelineToolState>((set) => ({
  tool: 'select',
  armed: null,
  trimMode: 'ripple',
  // Picking a tool drops an armed trim: the two are different answers to "what does a drag do".
  setTool: (tool) => set({ tool, armed: null }),
  arm: (mode) => set(mode ? { armed: mode, tool: 'select' } : { armed: null }),
  setTrimMode: (trimMode) => set({ trimMode, tool: 'trim', armed: null })
}))

/** What a trim mode is called where a person reads it. */
export const TRIM_MODE_LABEL: Record<TrimMode, string> = { slip: 'Slip', slide: 'Slide', roll: 'Roll' }

/** The Trim tool's modes in menu order, with what each does, for the toolbar's Trim menu. */
export const TRIM_TOOL_MODES: readonly { mode: TrimToolMode; label: string; detail: string }[] = [
  { mode: 'ripple', label: 'Ripple', detail: 'Drag an edge: later clips close up or make room' },
  { mode: 'roll', label: 'Roll', detail: 'Drag near a cut: both clips trim, nothing moves' },
  { mode: 'slip', label: 'Slip', detail: 'Drag a clip: change which part of its footage plays' },
  { mode: 'slide', label: 'Slide', detail: 'Drag a clip: move it, its neighbours trim to follow' }
]

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
