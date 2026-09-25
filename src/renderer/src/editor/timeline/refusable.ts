/**
 * One undo step that can still be refused after it has started.
 *
 * `transact` commits whatever its work changed, even a half: that is right for an edit that threw,
 * and wrong for one that found out partway that it must not happen. A ripple that moved clips to
 * make room and was then refused its trim, or a Replace that deleted its target and then could not
 * place the new clip there, has to leave the project as it was — the same object, not a copy with
 * the same clips, because an equal copy still pushes an undo step that undoes nothing and marks
 * the document unsaved.
 *
 * So the state the edits touch is noted before the work and put back when the work refuses. The
 * project goes back by identity, which is what `transact`'s close compares, so it pushes no entry.
 * This is a rollback to a state the store already held, not a mutation around `edit()`.
 */

import { useEditor } from '@/store/editor'
import type { EditorStore } from '@/store/types'

type Restored = Pick<EditorStore, 'project' | 'dirty' | 'selection' | 'agentTurnEdited' | 'agentTurnUserEdited'>

/**
 * Runs `work` as one undo step. `work` returns a reason to refuse, or null when it did its edit;
 * on a refusal everything it changed is put back and no undo step is left. Returns the reason.
 */
export function refusableEdit(work: () => string | null): string | null {
  const state = useEditor.getState()
  const before: Restored = {
    project: state.project,
    dirty: state.dirty,
    selection: state.selection,
    agentTurnEdited: state.agentTurnEdited,
    agentTurnUserEdited: state.agentTurnUserEdited
  }
  let refused: string | null = null
  state.transact(() => {
    refused = work()
    if (refused !== null) useEditor.setState(before)
  })
  return refused
}
