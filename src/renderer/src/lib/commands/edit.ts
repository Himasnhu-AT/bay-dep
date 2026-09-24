import { allItems } from '@shared/project'
import { selectTimeline } from '@/store/editor'
import type { CommandContext, Handlers } from './types'

/**
 * Undo/Redo from the menu while a text field has focus undo the *text*, as the system role
 * would have; everywhere else they are bay's history. (From the keyboard they never see a text
 * field: the key handler leaves ⌘Z to the field.)
 *
 * Cut/Copy/Paste run while typing too (`whileTyping`), and give the key back to the text the
 * same way: `document.execCommand` on the focused field, or on text selected on the page (a
 * reply in the agent panel). Only when neither applies do they act on clips.
 */

/** Whether ⌘C/⌘X belong to text: a field has focus, or the page has a text selection. */
function textWantsIt({ typing }: CommandContext): boolean {
  if (typing) return true
  const selection = globalThis.getSelection?.()
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0)
}

const inEditor = ({ state }: CommandContext): boolean => state.screen === 'editor'

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
  'edit.cut': {
    when: (ctx) => textWantsIt(ctx) || inEditor(ctx),
    run: (ctx) => {
      if (textWantsIt(ctx)) document.execCommand('cut')
      else ctx.state.cutSelection()
    }
  },
  'edit.copy': {
    when: (ctx) => textWantsIt(ctx) || inEditor(ctx),
    run: (ctx) => {
      if (textWantsIt(ctx)) {
        document.execCommand('copy')
        return
      }
      const count = ctx.state.copySelection()
      if (count > 0) ctx.state.notify(`Copied ${count} clip${count === 1 ? '' : 's'}. ⌘V pastes at the playhead.`)
    }
  },
  'edit.paste': {
    when: (ctx) => ctx.typing || inEditor(ctx),
    run: ({ state, typing }) => {
      if (!typing) {
        state.paste()
        return
      }
      // `execCommand('paste')` is the system role's own path. If this Chromium refuses it (it
      // returns false rather than throwing), read the text and type it in.
      if (document.execCommand('paste')) return
      void navigator.clipboard
        ?.readText()
        .then((text) => document.execCommand('insertText', false, text))
        .catch(() => state.notify('Could not read the clipboard to paste here.', 'error'))
    }
  },
  'edit.pasteAttributes': {
    when: inEditor,
    run: ({ state }) => {
      if (!state.clipboard) {
        state.notify('Copy a clip first (⌘C), then paste its attributes onto others.')
        return
      }
      if (state.selection.length === 0) {
        state.notify('Select the clips to paste attributes onto.')
        return
      }
      state.setClipDialog({ kind: 'pasteAttributes' })
    }
  },
  'edit.selectAll': {
    run: ({ state }) => {
      const timeline = selectTimeline(state)
      if (timeline) state.select(allItems(timeline).map((item) => item.id))
    }
  }
} satisfies Handlers
