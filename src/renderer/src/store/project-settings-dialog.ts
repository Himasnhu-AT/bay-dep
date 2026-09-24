/**
 * Whether Project Settings is open, and a canvas size to start it with. Its own small store so
 * the command (`file.projectSettings`) and the export form's "Change canvas to match…" can both
 * open it without a route through App's React state.
 */

import { create } from 'zustand'

export interface CanvasProposal {
  width: number
  height: number
  /** Why this size is being proposed, shown at the top of the dialog. */
  reason: string
}

interface ProjectSettingsDialog {
  open: boolean
  /** A size to show as the choice when the dialog opens, instead of the current canvas. */
  proposal: CanvasProposal | null
  show(proposal?: CanvasProposal): void
  close(): void
}

export const useProjectSettingsDialog = create<ProjectSettingsDialog>((set) => ({
  open: false,
  proposal: null,
  show: (proposal) => set({ open: true, proposal: proposal ?? null }),
  close: () => set({ open: false, proposal: null })
}))
