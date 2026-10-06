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
  { id: 'timeline.closeGap', label: 'Close Gap at Playhead', group: 'Timeline' },
  SEPARATOR,
  // The selected clip's track, one row up or down the stack (`@shared/track-order`). Dragging a
  // track's header does the same.
  { id: 'timeline.moveTrackUp', label: 'Move Track Up', group: 'Timeline' },
  { id: 'timeline.moveTrackDown', label: 'Move Track Down', group: 'Timeline' },
  SEPARATOR,
  // The pointer tools, on Final Cut's and Resolve's letters. Escape also returns to Select.
  { id: 'tool.select', label: 'Select Tool', group: 'Timeline', shortcut: 'A' },
  { id: 'tool.trim', label: 'Trim Tool', group: 'Timeline', shortcut: 'T' },
  { id: 'tool.blade', label: 'Blade Tool', group: 'Timeline', shortcut: 'B' }
] as const satisfies readonly CommandEntry[]
