import { SEPARATOR, type CommandEntry } from './types'

/** Timeline: the view of the timeline (zoom, fit, snapping) and closing gaps in it. */
export const timelineCommands = [
  // ⌘= / ⌘- are the NLE bindings. They used to reach Electron's page zoom, which main's View menu
  // no longer registers. The bare keys stay as aliases.
  { id: 'timeline.zoomIn', label: 'Zoom In', group: 'Timeline', shortcut: ['Mod+=', 'Mod++', '+', '='] },
  { id: 'timeline.zoomOut', label: 'Zoom Out', group: 'Timeline', shortcut: ['Mod+-', '-', '_'] },
  { id: 'timeline.zoomToFit', label: 'Zoom to Fit', group: 'Timeline', shortcut: 'Shift+Z' },
  SEPARATOR,
  { id: 'timeline.toggleSnapping', label: 'Toggle Snapping', group: 'Timeline', shortcut: 'N' },
  {
    id: 'timeline.toggleLinkedSelection',
    label: 'Toggle Linked Selection',
    group: 'Timeline',
    shortcut: 'Mod+Shift+L'
  },
  SEPARATOR,
  { id: 'timeline.closeGap', label: 'Close Gap at Playhead', group: 'Timeline' }
] as const satisfies readonly CommandEntry[]
