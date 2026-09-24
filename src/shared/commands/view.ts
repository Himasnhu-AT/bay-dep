import type { CommandEntry } from './types'

/** View. Main appends the window-zoom and full-screen roles (and DevTools in development). */
export const viewCommands = [
  {
    id: 'view.toggleDebug',
    label: 'Toggle Debug Mode',
    group: 'View',
    shortcut: 'Mod+Alt+D',
    accelerator: 'native'
  }
] as const satisfies readonly CommandEntry[]
