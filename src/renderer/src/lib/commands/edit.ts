import { allItems } from '@shared/project'
import { selectTimeline } from '@/store/editor'
import type { Handlers } from './types'

/**
 * Undo/Redo from the menu while a text field has focus undo the *text*, as the system role
 * would have; everywhere else they are bay's history. (From the keyboard they never see a text
 * field: the key handler leaves ⌘Z to the field.)
 */
export const editHandlers = {
  'edit.undo': {
    run: ({ state, typing }) => {
      if (typing) document.execCommand('undo')
      else state.undo()
    }
  },
  'edit.redo': {
    run: ({ state, typing }) => {
      if (typing) document.execCommand('redo')
      else state.redo()
    }
  },
  'edit.selectAll': {
    run: ({ state }) => {
      const timeline = selectTimeline(state)
      if (timeline) state.select(allItems(timeline).map((item) => item.id))
    }
  }
} satisfies Handlers
