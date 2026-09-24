/**
 * Project Settings' Apply: all of it, as one undo step, or none of it.
 *
 * The canvas is the one part that can be refused, so it is checked — by `checkCanvasSize`, the
 * rule `resizeCanvas` itself applies — before anything is written, and it is the first write
 * inside the transaction, so a refusal there returns before the name, rate or background change.
 * Before this, a refused size still committed the rename, rate and background while the dialog
 * reported an error: half an Apply.
 */

import { activeTimeline, checkCanvasSize, type CanvasFit } from '@shared/project'
import type { EditorStore } from '@/store/editor'

export interface ProjectSettingsDraft {
  name: string
  width: number
  height: number
  fit: CanvasFit
  fps: number
  /** `#rrggbb`. */
  background: string
}

export type ProjectSettingsOutcome =
  | { ok: true; sizeChanged: boolean; refitted: number; nudged: number }
  | { ok: false; error: string }

export function applyProjectSettings(state: EditorStore, draft: ProjectSettingsDraft): ProjectSettingsOutcome {
  const timeline = activeTimeline(state.project)
  if (!timeline) return { ok: false, error: 'No timeline is open.' }
  const name = draft.name.trim()
  if (name === '') return { ok: false, error: 'A project needs a name.' }
  const sizeChanged = draft.width !== timeline.width || draft.height !== timeline.height
  if (sizeChanged) {
    const problem = checkCanvasSize(draft.width, draft.height)
    if (problem) return { ok: false, error: problem }
  }
  const outcome: { error: string | null; refitted: number; nudged: number } = { error: null, refitted: 0, nudged: 0 }
  state.transact(() => {
    if (sizeChanged) {
      const result = state.resizeCanvas(draft.width, draft.height, draft.fit)
      if ('error' in result) {
        outcome.error = result.error
        return
      }
      outcome.refitted = result.refitted
    }
    if (name !== state.project.name) state.renameProject(name)
    if (Math.abs(draft.fps - timeline.fps) > 1e-9) outcome.nudged = state.setFps(draft.fps).nudged
    if (draft.background.toLowerCase() !== timeline.background.toLowerCase()) state.setBackground(draft.background)
  })
  if (outcome.error) return { ok: false, error: outcome.error }
  return { ok: true, sizeChanged, refitted: outcome.refitted, nudged: outcome.nudged }
}
