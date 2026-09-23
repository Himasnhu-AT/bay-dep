/**
 * Opening, renaming and undoing the document: the project as a whole, and its history.
 *
 * `setProject` is here rather than with the agent even though half its body is about agent
 * checkpoints, because it is the one door a whole project comes in through.
 */

import type { EditorActions, EditorState } from '../types'
import type { StoreKit } from '../kit'
import { HISTORY_LIMIT } from '../kit'

type Actions = Pick<
  EditorActions,
  | 'setProject'
  | 'renameProject'
  | 'undo'
  | 'redo'
  | 'markSaved'
  | 'transact'
>

export function projectSlice({ set, get, history, edit, turnMarks, followReverts }: StoreKit): Actions {
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
      const state = get()
      const previous = state.past[state.past.length - 1]
      if (!previous) return
      set({
        project: previous,
        past: state.past.slice(0, -1),
        future: [state.project, ...state.future],
        selection: [],
        dirty: previous !== history.saved,
        ...turnMarks(state)
      })
      followReverts(previous)
    },

    redo() {
      const state = get()
      const next = state.future[0]
      if (!next) return
      set({
        project: next,
        past: [...state.past, state.project],
        future: state.future.slice(1),
        selection: [],
        dirty: next !== history.saved,
        ...turnMarks(state)
      })
      followReverts(next)
    },

    markSaved() {
      history.saved = get().project
      set({ dirty: false })
    },

    transact(work) {
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
