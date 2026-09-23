/**
 * What every slice of the editor store shares: `set` and `get`, the one `edit()` every project
 * mutation goes through, and the undo bookkeeping that has to be common to all of them.
 *
 * The store used to be one 1.5k-line closure, which made it the second most-edited file in the
 * tree and the one parallel edits collided in. The slices under `./slices/` each hold one
 * concern's actions; this is the part none of them can own alone. Nothing here is a new
 * mechanism — it is the closure the actions used to share, given a name.
 */

import type { StoreApi } from 'zustand'
import { activeTimeline, type Project, type Timeline } from '@shared/project'
import { clone } from './factory'
import { agentActingDepth, agentFileWriterNow } from './agent-turns'
import type { EditorState, EditorStore } from './types'

export const HISTORY_LIMIT = 100

type Set = StoreApi<EditorStore>['setState']
type Get = StoreApi<EditorStore>['getState']

/**
 * Undo bookkeeping outside the store's state, because none of it is anything a component should
 * re-render over.
 */
export interface History {
  /**
   * The project as last saved or opened — by identity, since every edit makes a new object.
   * Undo and redo compare against it, so undoing back to the saved state reads as saved rather
   * than leaving "Unsaved changes" up over a file that already holds exactly this.
   */
  saved: Project | null
  /**
   * Open transaction, if any: the project as it stood before it began, plus whether anything
   * inside it has actually asked for a history entry. Depth rather than a boolean so a
   * `transact` inside a `transact` joins the outer one instead of closing it early.
   */
  txDepth: number
  txBefore: Project | null
  txRecorded: boolean
}

export interface StoreKit {
  set: Set
  get: Get
  history: History
  edit(mutator: (project: Project) => void, options?: { silent?: boolean }): void
  editTimeline(mutator: (timeline: Timeline, project: Project) => void): void
  currentTimeline(): Timeline | undefined
  turnMarks(state: EditorState): Partial<EditorState>
  restoreFiles(ids: string[], side: 'before' | 'after'): void
  followReverts(project: Project): void
}

export function createKit(set: Set, get: Get): StoreKit {
  const history: History = { saved: null, txDepth: 0, txBefore: null, txRecorded: false }

  /**
   * Every mutation of `project` goes through here. It snapshots the previous project for
   * undo, stamps `updatedAt`, clears the redo stack and marks the document dirty — so no
   * caller has to remember to do any of that, and none of them can forget.
   */
  function edit(mutator: (project: Project) => void, options?: { silent?: boolean }): void {
    set((state) => {
      const before = state.project
      const next = clone(before)
      mutator(next)

      // A mutator that declined to do anything must leave no trace. Several of them refuse
      // by design — `moveItem` onto occupied time, `patchTrack` on a missing track, a split
      // exactly on an item edge — and without this each refusal stamped `updatedAt`, marked
      // the document dirty and pushed a history entry that undoes nothing. An undo step that
      // restores the state you are already in is a control that does nothing, and a row of
      // them makes Cmd+Z feel broken.
      //
      // Compared before `updatedAt` is stamped, so the clone is byte-identical when nothing
      // changed. The stringify is affordable because edits happen at human scale — a drag
      // commits on drop, not per mousemove — and the alternative, asking every mutator to
      // report whether it did anything, is a thing thirty call sites can forget.
      if (JSON.stringify(before) === JSON.stringify(next)) return state

      next.updatedAt = Date.now()
      if (options?.silent) {
        return { project: next }
      }
      const turn = turnMarks(state)
      if (history.txDepth > 0) {
        // Inside a transaction the mutation lands but the history entry does not: the whole
        // group gets one, pushed on close. Without this, a tool that needs two store calls
        // makes two undo steps and `undo` reverses half of what it did.
        history.txRecorded = true
        return { project: next, dirty: true, ...turn }
      }
      const past = [...state.past, before]
      if (past.length > HISTORY_LIMIT) past.shift()
      return { project: next, past, future: [], dirty: true, ...turn }
    })
  }

  /**
   * What a real change to the project means for the agent turn in progress, if one is: the turn
   * changed something, and — when no agent tool call is running — the user did.
   */
  function turnMarks(state: EditorState): Partial<EditorState> {
    if (!state.agentRunning) return {}
    return agentActingDepth() > 0 ? { agentTurnEdited: true } : { agentTurnEdited: true, agentTurnUserEdited: true }
  }

  /**
   * Put files back to what one side of a set of turns held — `before` for a revert, `after` for
   * undoing one. Earliest turn's `before` wins per path; latest turn's `after`. A file that did not
   * exist before is left alone: the revert removes what uses it, and deleting a file the user may
   * have opened elsewhere is not a revert's call to make.
   */
  function restoreFiles(ids: string[], side: 'before' | 'after'): void {
    const checkpoints = get().agentCheckpoints
    const target = new Map<string, string>()
    const ordered = side === 'before' ? [...ids].reverse() : ids
    for (const id of ordered) {
      for (const file of checkpoints[id]?.files ?? []) {
        const contents = file[side]
        if (contents !== null) target.set(file.path, contents)
      }
    }
    if (target.size === 0) return
    const writer = agentFileWriterNow()
    if (!writer) {
      get().notify('The project was restored, but the composition files could not be: this window cannot write files.', 'error')
      return
    }
    for (const [path, contents] of target) {
      void writer(path, contents).then(
        (result) => {
          if (result.ok) get().markCompositionChanged(path)
          else get().notify(`Could not restore ${path}: ${result.error ?? 'the write failed'}.`, 'error')
        },
        (error: unknown) => get().notify(`Could not restore ${path}: ${String(error)}.`, 'error')
      )
    }
  }

  /**
   * After undo or redo lands on `project`, bring the change cards along: undoing a revert makes
   * its turns applied again (and rewrites their files); redoing it reverts them again.
   */
  function followReverts(project: Project): void {
    for (const record of get().agentReverts) {
      const to = project === record.replaced ? 'applied' : project === record.restored ? 'reverted' : null
      if (!to) continue
      const changed: string[] = []
      set((state) => ({
        agentLog: state.agentLog.map((entry) => {
          if (entry.kind !== 'changes' || !record.ids.includes(entry.id) || entry.state === to || entry.state === 'expired') {
            return entry
          }
          changed.push(entry.id)
          return { ...entry, state: to }
        })
      }))
      if (changed.length > 0) restoreFiles(changed, to === 'applied' ? 'after' : 'before')
    }
  }

  /** Runs `mutator` against the active timeline, or does nothing if there isn't one. */
  function editTimeline(mutator: (timeline: Timeline, project: Project) => void): void {
    edit((project) => {
      const timeline = activeTimeline(project)
      if (!timeline) return
      mutator(timeline, project)
    })
  }

  function currentTimeline(): Timeline | undefined {
    return activeTimeline(get().project)
  }

  return { set, get, history, edit, editTimeline, currentTimeline, turnMarks, restoreFiles, followReverts }
}
