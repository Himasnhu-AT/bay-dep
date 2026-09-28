/**
 * Opening, renaming and undoing the document: the project as a whole, and its history.
 *
 * `setProject` is here rather than with the agent even though half its body is about agent
 * checkpoints, because it is the one door a whole project comes in through.
 */

import { activeTimeline, allItems, type Project } from '@shared/project'
import type { EditorActions, EditorState } from '../types'
import type { StoreKit } from '../kit'
import { HISTORY_LIMIT } from '../kit'

/**
 * The selection that survives stepping to `project`: every selected clip that still exists there.
 * Undo and redo used to clear it, so a ⌘Z made in the inspector emptied the inspector and sent
 * the next arrow key to the playhead instead of the clip.
 */
export function selectionAfter(selection: readonly string[], before: Project, after: Project): string[] {
  const timeline = activeTimeline(after)
  if (!timeline) return []
  const present = new Set(allItems(timeline).map((item) => item.id))
  const kept = selection.filter((id) => present.has(id))
  if (kept.length > 0) return kept
  // Nothing selected survived — typically undoing a delete, which had emptied the selection. The
  // clips the step brought back are what the user is looking for; select them, as editors do.
  const had = activeTimeline(before)
  const existed = new Set(had ? allItems(had).map((item) => item.id) : [])
  return allItems(timeline)
    .map((item) => item.id)
    .filter((id) => !existed.has(id))
}

type Actions = Pick<
  EditorActions,
  | 'setProject'
  | 'renameProject'
  | 'undo'
  | 'redo'
  | 'markSaved'
  | 'markSavedAs'
  | 'transact'
  | 'beginGesture'
  | 'endGesture'
>

export function projectSlice({ set, get, history, edit, turnMarks, followReverts, closeGestureStep, reopenGesture, aside, intrudes }: StoreKit): Actions {
  return {
    // -- project ------------------------------------------------------------
    setProject(project, options) {
      // A project handed in whole is as it stands on disk (opened, created, or just saved).
      history.saved = project
      set((state) => {
        // A different project makes every checkpoint a snapshot of something else: reverting one
        // would put that project's contents in this window, and a save would write them over
        // this file. So they go, and their cards say they can no longer be reverted. A turn in
        // progress (the agent opened this project itself) diffs from here on.
        const switched = project.id !== state.project.id
        const agent: Partial<EditorState> = switched
          ? {
              agentCheckpoints: {},
              agentReverts: [],
              agentTurnFiles: {},
              agentTurnEdited: false,
              agentTurnUserEdited: false,
      agentTurnClientEdited: false,
              agentTurnBase: state.agentRunning ? project : null,
              agentProposal: null,
              agentPins: [],
              agentGate: state.agentGate ? { approved: null } : null,
              agentLog: state.agentLog.map((entry) =>
                entry.kind === 'changes' && entry.state !== 'expired' ? { ...entry, state: 'expired' as const } : entry
              )
            }
          : {}
        return {
          project,
          selection: [],
          playhead: 0,
          playing: false,
          dirty: false,
          past: options?.resetHistory === false ? state.past : [],
          future: [],
          ...agent
        }
      })
    },

    renameProject(name) {
      edit((project) => {
        project.name = name
      })
    },

    // -- history ------------------------------------------------------------
    undo() {
      // Inside a gesture (a wheel stays open 400 ms after its last notch, and ⌘Z reaches the
      // store while a knob or slider has focus), the gesture's changes so far become a step first
      // and this undoes them; the gesture then carries on from the undone state. Without it, undo
      // reached past the gesture's start, and closing the gesture pushed the pre-gesture state
      // and cleared redo.
      closeGestureStep()
      const state = get()
      const previous = state.past[state.past.length - 1]
      if (!previous) return
      set({
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future],
        selection: selectionAfter(state.selection, state.project, previous),
        dirty: previous !== history.saved,
        ...turnMarks(state)
      })
      followReverts(previous)
      reopenGesture()
    },

    redo() {
      closeGestureStep()
      const state = get()
      const next = state.future[0]
      if (!next) return
      set({
        project: next,
        past: [...state.past, state.project],
        future: state.future.slice(1),
        selection: selectionAfter(state.selection, state.project, next),
        dirty: next !== history.saved,
        ...turnMarks(state)
      })
      followReverts(next)
      reopenGesture()
    },

    markSaved() {
      history.saved = get().project
      set({ dirty: false })
    },

    markSavedAs(filePath, name) {
      const moved = <T extends { filePath?: string | null; name: string }>(project: T): T => ({ ...project, filePath, name })
      set((state) => ({ project: moved(state.project), past: state.past.map(moved), future: state.future.map(moved) }))
      history.saved = get().project
      set({ dirty: false })
    },

    beginGesture() {
      if (history.txDepth === 0) {
        history.txBefore = get().project
        history.txRecorded = false
      }
      history.txDepth += 1
      history.gestureDepth += 1
    },

    endGesture() {
      if (history.gestureDepth === 0 || history.txDepth === 0) return
      history.gestureDepth -= 1
      history.txDepth -= 1
      if (history.txDepth > 0) return
      const before = history.txBefore
      history.txBefore = null
      const recorded = history.txRecorded
      history.txRecorded = false
      set((state) => {
        if (!recorded || !before || before === state.project) return state
        const past = [...state.past, before]
        if (past.length > HISTORY_LIMIT) past.shift()
        return { past, future: [], dirty: true }
      })
    },

    transact(work) {
      // An agent's (or MCP client's) call arriving while the user's gesture is open is its own
      // step, not a part of the user's drag that one ⌘Z would take back with it.
      if (intrudes()) return aside(() => get().transact(work))
      if (history.txDepth > 0) {
        // Already inside one: join it. Closing here would end the outer group early and
        // split one logical edit across two undo steps, which is the bug this prevents.
        work()
        return
      }
      history.txBefore = get().project
      history.txRecorded = false
      history.txDepth += 1
      try {
        work()
      } finally {
        history.txDepth -= 1
        const before = history.txBefore
        history.txBefore = null
        const recorded = history.txRecorded
        history.txRecorded = false
        set((state) => {
          // No history entry for a transaction that recorded nothing, and none if the
          // project came back to the object it started from — an undo step that restores
          // the state you are already in is a control that does nothing.
          if (!recorded || !before || before === state.project) return state
          const past = [...state.past, before]
          if (past.length > HISTORY_LIMIT) past.shift()
          return { past, future: [], dirty: true }
        })
      }
    }
  }
}
