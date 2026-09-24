import type { CommandEntry } from './types'

/** Mark: markers (and, later, in/out points). */
export const markCommands = [
  { id: 'mark.add', label: 'Add Marker', group: 'Mark', shortcut: 'M' },
  {
    id: 'mark.removeHere',
    label: 'Remove Marker at Playhead',
    group: 'Mark',
    shortcut: 'Shift+M'
  }
] as const satisfies readonly CommandEntry[]
