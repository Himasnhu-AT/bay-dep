import { SEPARATOR, type CommandEntry } from './types'

/**
 * Edit. Undo/Redo are bay's history, not the system text stack: renderer-owned keys, so in a
 * text field ⌘Z stays the field's own undo, and from the menu the handler picks by focus. Cut,
 * Copy, Paste and Select All are system roles main appends after these, because they must keep
 * working in text fields. Select All Clips shares ⌘A with that role, so it stays out of the menu.
 */
export const editCommands = [
  { id: 'edit.undo', label: 'Undo', group: 'Edit', shortcut: 'Mod+Z' },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', shortcut: 'Mod+Shift+Z' },
  SEPARATOR,
  {
    id: 'edit.selectAll',
    label: 'Select All Clips',
    group: 'Edit',
    shortcut: 'Mod+A',
    menu: false
  }
] as const satisfies readonly CommandEntry[]
