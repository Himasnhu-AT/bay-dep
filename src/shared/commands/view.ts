import { SEPARATOR, type CommandEntry } from './types'

/** View. Main appends the window-zoom and full-screen roles (and DevTools in development). */
export const viewCommands = [
  {
    id: 'view.toggleDebug',
    label: 'Toggle Debug Mode',
    group: 'View',
    shortcut: 'Mod+Alt+D',
    accelerator: 'native'
  },
  SEPARATOR,
  // The viewer's overlays: toggles, remembered per machine like a monitor's own settings.
  { id: 'view.safeAreas', label: 'Show Safe Areas', group: 'View', shortcut: "Mod+'" },
  { id: 'view.grid', label: 'Show Thirds Grid', group: 'View' },
  {
    // ⌘⇧F is Final Cut's. The window's own full screen stays on ⌃⌘F (main's role); Escape exits.
    id: 'view.fullscreenPreview',
    label: 'Full-Screen Preview',
    group: 'View',
    shortcut: 'Mod+Shift+F'
  },
  // Crop by dragging the selected clip's edges in the viewer — the inspector's Crop fields.
  { id: 'view.cropMode', label: 'Crop in Viewer', group: 'View', shortcut: 'Shift+C' }
] as const satisfies readonly CommandEntry[]
