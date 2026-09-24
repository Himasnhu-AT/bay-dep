import { SEPARATOR, type CommandEntry } from './types'

/**
 * Edit. Undo/Redo are bay's history, not the system text stack: renderer-owned keys, so in a
 * text field ⌘Z stays the field's own undo, and from the menu the handler picks by focus.
 *
 * Cut, Copy and Paste have the same shape. They used to be system roles, which made ⌘C/⌘V
 * text-only. Now they are commands that run `whileTyping`. While a text field has focus (or text
 * is selected on the page) they hand the key to the text through `document.execCommand`, the way
 * Undo does. Otherwise they cut, copy and paste *clips*. Select All shares ⌘A with the text-field
 * role main keeps, so it stays out of the menu.
 */
export const editCommands = [
  { id: 'edit.undo', label: 'Undo', group: 'Edit', shortcut: 'Mod+Z' },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', shortcut: 'Mod+Shift+Z' },
  SEPARATOR,
  { id: 'edit.cut', label: 'Cut', group: 'Edit', shortcut: 'Mod+X', whileTyping: true },
  { id: 'edit.copy', label: 'Copy', group: 'Edit', shortcut: 'Mod+C', whileTyping: true },
  { id: 'edit.paste', label: 'Paste', group: 'Edit', shortcut: 'Mod+V', whileTyping: true },
  {
    id: 'edit.pasteAttributes',
    label: 'Paste Attributes…',
    group: 'Edit',
    shortcut: 'Mod+Alt+Shift+V'
  },
  SEPARATOR,
  {
    id: 'edit.selectAll',
    label: 'Select All Clips',
    group: 'Edit',
    shortcut: 'Mod+A',
    menu: false
  }
] as const satisfies readonly CommandEntry[]
