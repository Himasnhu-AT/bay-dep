import { SEPARATOR, type CommandEntry } from './types'

/**
 * Mark: markers and the In/Out range. Out is exclusive (`rangeOut` is the first frame after the
 * range), so going to the next edit and pressing O marks exactly up to that cut.
 */
export const markCommands = [
  { id: 'mark.add', label: 'Add Marker', group: 'Mark', shortcut: 'M' },
  {
    id: 'mark.removeHere',
    label: 'Remove Marker at Playhead',
    group: 'Mark',
    shortcut: 'Shift+M'
  },
  SEPARATOR,
  { id: 'mark.setIn', label: 'Set In', group: 'Mark', shortcut: 'I' },
  { id: 'mark.setOut', label: 'Set Out', group: 'Mark', shortcut: 'O' },
  { id: 'mark.clearRange', label: 'Clear In and Out', group: 'Mark', shortcut: 'Alt+X' },
  { id: 'mark.goToIn', label: 'Go to In', group: 'Mark', shortcut: 'Shift+I' },
  { id: 'mark.goToOut', label: 'Go to Out', group: 'Mark', shortcut: 'Shift+O' },
  SEPARATOR,
  // ⇧⌘⌫ rather than ⇧⌫. ⇧⌫ is Ripple Delete of the selection, and a key that did two different
  // removals depending on whether a range happened to be set would cut time by accident.
  {
    id: 'mark.removeRange',
    label: 'Remove In to Out',
    group: 'Mark',
    shortcut: ['Mod+Shift+Backspace', 'Mod+Shift+Delete']
  }
] as const satisfies readonly CommandEntry[]
