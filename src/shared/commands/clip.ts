import { SEPARATOR, type CommandEntry } from './types'

/** Clip: acting on the selected clips. */
export const clipCommands = [
  { id: 'clip.split', label: 'Split at Playhead', group: 'Clip', shortcut: 'S' },
  { id: 'clip.duplicate', label: 'Duplicate', group: 'Clip', shortcut: 'Mod+D' },  SEPARATOR,
  // Shift is ripple, as in Premiere and Resolve: plain Delete lifts and leaves the gap.
  { id: 'clip.delete', label: 'Delete', group: 'Clip', shortcut: ['Delete', 'Backspace'] },
  {
    id: 'clip.rippleDelete',
    label: 'Ripple Delete',
    group: 'Clip',
    shortcut: ['Shift+Delete', 'Shift+Backspace']
  }
] as const satisfies readonly CommandEntry[]
