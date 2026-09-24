import { SEPARATOR, type CommandEntry } from './types'

/** File. `app.settings` is drawn in the application menu on macOS, in File elsewhere. */
export const fileCommands = [
  {
    id: 'file.newProject',
    label: 'New Project',
    group: 'File',
    shortcut: 'Mod+N',
    accelerator: 'native'
  },
  { id: 'file.open', label: 'Open…', group: 'File', shortcut: 'Mod+O', accelerator: 'native' },
  SEPARATOR,
  { id: 'file.save', label: 'Save', group: 'File', shortcut: 'Mod+S', accelerator: 'native' },
  {
    id: 'file.saveAs',
    label: 'Save As…',
    group: 'File',
    shortcut: 'Mod+Shift+S',
    accelerator: 'native'
  },
  SEPARATOR,
  {
    id: 'file.import',
    label: 'Import Media…',
    group: 'File',
    shortcut: 'Mod+I',
    accelerator: 'native'
  },
  { id: 'file.importCaptions', label: 'Import Captions…', group: 'File' },
  { id: 'file.export', label: 'Export…', group: 'File', shortcut: 'Mod+E', accelerator: 'native' },
  SEPARATOR,
  {
    id: 'app.settings',
    label: 'Settings…',
    group: 'File',
    shortcut: 'Mod+,',
    accelerator: 'native'
  }
] as const satisfies readonly CommandEntry[]
