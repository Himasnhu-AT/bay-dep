import type { CommandEntry } from './types'

/** Help. */
export const helpCommands = [
  { id: 'help.shortcuts', label: 'Keyboard Shortcuts', group: 'Help', shortcut: ['Mod+/', '?'] }
] as const satisfies readonly CommandEntry[]
