/**
 * Copy Grade / Paste Grade on the Color page.
 *
 * A clipboard of its own rather than the clip clipboard (⌘C), for two reasons: copying a look
 * must not replace the clips someone copied to paste elsewhere, and the clip clipboard carries
 * the linked audio too, so "the first copied item" is not reliably the picture. What a paste
 * *writes* is not re-decided here: it is `attributePatch` from `@shared/clipboard`, the same patch
 * Paste Attributes applies for "Colour grade" and "Adjustments" — so a pasted "no grade" removes
 * the grade, exactly as there. Blend mode rides with Adjustments in Paste Attributes; a grade is
 * not a composite mode, so it is left out of this paste.
 */

import { create } from 'zustand'
import { defaultAdjustments, type Item } from '@shared/project'
import { useEditor } from '@/store/editor'
import { gradePatch, lookForProject } from './clips'

interface GradeClipboard {
  /** A snapshot of the copied clip's look, or null before anything is copied. */
  source: Pick<Item, 'grade' | 'adjustments'> | null
  /** The copied clip's name, for the Paste button's tooltip. */
  sourceName: string | null
  copy(item: Item, name: string): void
}

export const useGradeClipboard = create<GradeClipboard>((set) => ({
  source: null,
  sourceName: null,
  copy(item, name) {
    // A deep copy: the store's items are replaced on edit, but a snapshot must not move with them.
    set({ source: structuredClone({ grade: item.grade, adjustments: item.adjustments }), sourceName: name })
  }
}))

/**
 * Pastes the copied look onto `targets` as one undo step. Returns how many clips took it, and
 * whether the copied LUT was left out because it is not in this project (`lookForProject`).
 */
export function pasteGrade(targets: readonly Item[]): { count: number; droppedLut: boolean } {
  const { source } = useGradeClipboard.getState()
  if (!source || targets.length === 0) return { count: 0, droppedLut: false }
  const { transact, patchItem, project } = useEditor.getState()
  const { look, droppedLut } = lookForProject(source, project)
  transact(() => {
    for (const target of targets) patchItem(target.id, gradePatch(look, target))
  })
  return { count: targets.length, droppedLut: droppedLut !== null }
}

/** Takes the grade and adjustments off `targets`, as one undo step. */
export function resetGrade(targets: readonly Item[]): void {
  const { transact, patchItem } = useEditor.getState()
  transact(() => {
    for (const target of targets) patchItem(target.id, { grade: undefined, adjustments: defaultAdjustments() })
  })
}
